import { MigrationInterface, QueryRunner } from "typeorm";
import { logger } from "../observability/logger";
import { AppError } from "../utils/http-error";

const MIGRATION_NAME = "CreateIssuerReputationTable1754100000000";

/**
 * Creates table for issuer reputation scores with history tracking.
 *
 * - issuer_reputations: stores reputation scores per issuer wallet
 * - issuer_reputation_history: tracks score changes over time
 */
export class CreateIssuerReputationTable1754100000000 implements MigrationInterface {
  name = MIGRATION_NAME;

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      logger.info("migration.start", { name: MIGRATION_NAME, direction: "up" });

      await this.ensureTable(queryRunner, "issuer_reputations", this.createIssuerReputationsTable);
      await this.ensureTable(queryRunner, "issuer_reputation_history", this.createIssuerReputationHistoryTable);

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

      await this.dropTable(queryRunner, "issuer_reputation_history");
      await this.dropTable(queryRunner, "issuer_reputations");

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

  private async createIssuerReputationsTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."issuer_reputations" (
        "id" SERIAL PRIMARY KEY,
        "wallet_address" VARCHAR(56) NOT NULL UNIQUE,
        "score" INTEGER NOT NULL CHECK ("score" >= 0 AND "score" <= 100),
        "tier" VARCHAR(20) NOT NULL CHECK ("tier" IN ('poor', 'fair', 'good', 'excellent')),
        "total_invoices_settled" INTEGER NOT NULL DEFAULT 0,
        "on_time_settlement_rate" DECIMAL(5, 2) NOT NULL DEFAULT 0,
        "avg_days_late" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "avg_days_early" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "last_settled_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_issuer_reputations_wallet" ON "public"."issuer_reputations"("wallet_address")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_issuer_reputations_score" ON "public"."issuer_reputations"("score")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_issuer_reputations_tier" ON "public"."issuer_reputations"("tier")
    `);

    logger.info("migration.table_created", { table: "issuer_reputations" });
  }

  private async createIssuerReputationHistoryTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."issuer_reputation_history" (
        "id" SERIAL PRIMARY KEY,
        "issuer_reputation_id" INTEGER NOT NULL REFERENCES "public"."issuer_reputations"("id") ON DELETE CASCADE,
        "old_score" INTEGER,
        "old_tier" VARCHAR(20),
        "new_score" INTEGER NOT NULL,
        "new_tier" VARCHAR(20) NOT NULL,
        "invoice_id" VARCHAR(64),
        "settlement_was_on_time" BOOLEAN,
        "trigger_reason" VARCHAR(100) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_issuer_reputation_history_id" ON "public"."issuer_reputation_history"("issuer_reputation_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_issuer_reputation_history_created_at" ON "public"."issuer_reputation_history"("created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_issuer_reputation_history_invoice" ON "public"."issuer_reputation_history"("invoice_id")
    `);

    logger.info("migration.table_created", { table: "issuer_reputation_history" });
  }
}
