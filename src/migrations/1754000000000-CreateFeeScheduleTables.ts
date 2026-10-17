import { MigrationInterface, QueryRunner } from "typeorm";
import { logger } from "../observability/logger";
import { AppError } from "../utils/http-error";

const MIGRATION_NAME = "CreateFeeScheduleTables1754000000000";

/**
 * Creates tables for platform fee schedule management with change history.
 *
 * - fee_schedules: stores the current active fee rates
 * - fee_schedule_history: tracks all changes with actor, old values, and timestamps
 */
export class CreateFeeScheduleTables1754000000000 implements MigrationInterface {
  name = MIGRATION_NAME;

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      logger.info("migration.start", { name: MIGRATION_NAME, direction: "up" });

      await this.ensureTable(queryRunner, "fee_schedules", this.createFeeSchedulesTable);
      await this.ensureTable(queryRunner, "fee_schedule_history", this.createFeeScheduleHistoryTable);

      // Insert default fee schedule
      await this.insertDefaultFeeSchedule(queryRunner);

      logger.info("migration.complete", { name: MIGRATION_NAME, direction: "up" });
    } catch (error) {
      logger.error("migration.failed", {
        name: MIGRATION_NAME,
        direction: "up",
        error,
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(500, `Migration "${MIGRATION_NAME}" failed: ${message}`, "MIGRATION_FAILED", {
        name: MIGRATION_NAME,
      });
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    try {
      logger.info("migration.start", { name: MIGRATION_NAME, direction: "down" });

      await this.dropTable(queryRunner, "fee_schedule_history");
      await this.dropTable(queryRunner, "fee_schedules");

      logger.info("migration.complete", { name: MIGRATION_NAME, direction: "down" });
    } catch (error) {
      logger.error("migration.failed", {
        name: MIGRATION_NAME,
        direction: "down",
        error,
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(
        500,
        `Migration "${MIGRATION_NAME}" rollback failed: ${message}`,
        "MIGRATION_ROLLBACK_FAILED",
        { name: MIGRATION_NAME }
      );
    }
  }

  private async ensureTable(
    queryRunner: QueryRunner,
    tableName: string,
    create: (runner: QueryRunner) => Promise<void>
  ): Promise<void> {
    const exists = await this.tableExists(queryRunner, tableName);
    if (exists) {
      logger.warn("migration.table_exists", { table: tableName, skipped: "create" });
      return;
    }
    await create(queryRunner);
  }

  private async tableExists(queryRunner: QueryRunner, tableName: string): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT to_regclass('public."${tableName}"') AS "table"`
    );
    const first = rows?.[0] as { table?: string | null } | undefined;
    return Boolean(first?.table);
  }

  private async dropTable(queryRunner: QueryRunner, tableName: string): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public"."${tableName}" CASCADE`);
  }

  private async createFeeSchedulesTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."fee_schedules" (
        "id" SERIAL PRIMARY KEY,
        "investment_fee_bps" INTEGER NOT NULL DEFAULT 100 CHECK ("investment_fee_bps" >= 0 AND "investment_fee_bps" <= 1000),
        "settlement_fee_bps" INTEGER NOT NULL DEFAULT 50 CHECK ("settlement_fee_bps" >= 0 AND "settlement_fee_bps" <= 1000),
        "platform_fee_bps" INTEGER NOT NULL DEFAULT 100 CHECK ("platform_fee_bps" >= 0 AND "platform_fee_bps" <= 1000),
        "secondary_market_fee_bps" INTEGER NOT NULL DEFAULT 150 CHECK ("secondary_market_fee_bps" >= 0 AND "secondary_market_fee_bps" <= 1000),
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "effective_until" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "only_one_active_schedule" EXCLUDE (USING gist("is_active" WITH =) WHERE ("is_active" = true))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_fee_schedules_is_active" ON "public"."fee_schedules"("is_active")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_fee_schedules_effective_dates" ON "public"."fee_schedules"("effective_from", "effective_until")
    `);

    logger.info("migration.table_created", { table: "fee_schedules" });
  }

  private async createFeeScheduleHistoryTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."fee_schedule_history" (
        "id" SERIAL PRIMARY KEY,
        "fee_schedule_id" INTEGER NOT NULL REFERENCES "public"."fee_schedules"("id") ON DELETE CASCADE,
        "actor_wallet" VARCHAR(56) NOT NULL,
        "actor_role" VARCHAR(50) NOT NULL DEFAULT 'admin',
        "old_investment_fee_bps" INTEGER,
        "old_settlement_fee_bps" INTEGER,
        "old_platform_fee_bps" INTEGER,
        "old_secondary_market_fee_bps" INTEGER,
        "new_investment_fee_bps" INTEGER NOT NULL,
        "new_settlement_fee_bps" INTEGER NOT NULL,
        "new_platform_fee_bps" INTEGER NOT NULL,
        "new_secondary_market_fee_bps" INTEGER NOT NULL,
        "change_reason" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_fee_schedule_history_schedule_id" ON "public"."fee_schedule_history"("fee_schedule_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_fee_schedule_history_created_at" ON "public"."fee_schedule_history"("created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_fee_schedule_history_actor" ON "public"."fee_schedule_history"("actor_wallet")
    `);

    logger.info("migration.table_created", { table: "fee_schedule_history" });
  }

  private async insertDefaultFeeSchedule(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "public"."fee_schedules" (
        "investment_fee_bps",
        "settlement_fee_bps",
        "platform_fee_bps",
        "secondary_market_fee_bps",
        "is_active",
        "effective_from"
      ) VALUES (100, 50, 100, 150, true, NOW())
    `);

    logger.info("migration.default_data_inserted", { table: "fee_schedules" });
  }
}
