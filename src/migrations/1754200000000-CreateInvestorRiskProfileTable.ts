import { MigrationInterface, QueryRunner } from "typeorm";
import { logger } from "../observability/logger";
import { AppError } from "../utils/http-error";

const MIGRATION_NAME = "CreateInvestorRiskProfileTable1754200000000";

/**
 * Creates table for investor risk profiles with questionnaire responses.
 *
 * - investor_risk_profiles: stores risk questionnaire responses and computed tiers
 */
export class CreateInvestorRiskProfileTable1754200000000 implements MigrationInterface {
  name = MIGRATION_NAME;

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      logger.info("migration.start", { name: MIGRATION_NAME, direction: "up" });

      await this.ensureTable(queryRunner, "investor_risk_profiles", this.createInvestorRiskProfilesTable);

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

      await this.dropTable(queryRunner, "investor_risk_profiles");

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

  private async createInvestorRiskProfilesTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."investor_risk_profiles" (
        "id" SERIAL PRIMARY KEY,
        "wallet_address" VARCHAR(56) NOT NULL UNIQUE,
        "tier" VARCHAR(20) NOT NULL CHECK ("tier" IN ('conservative', 'moderate', 'aggressive')),
        "investment_experience" VARCHAR(20) NOT NULL CHECK ("investment_experience" IN ('none', 'limited', 'experienced')),
        "time_horizon" VARCHAR(20) NOT NULL CHECK ("time_horizon" IN ('short', 'medium', 'long')),
        "risk_tolerance" VARCHAR(20) NOT NULL CHECK ("risk_tolerance" IN ('low', 'medium', 'high')),
        "annual_income_range" VARCHAR(30) NOT NULL,
        "net_worth_range" VARCHAR(30) NOT NULL,
        "investment_objective" VARCHAR(50) NOT NULL,
        "loss_tolerance_percentage" INTEGER NOT NULL CHECK ("loss_tolerance_percentage" >= 0 AND "loss_tolerance_percentage" <= 100),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_investor_risk_profiles_wallet" ON "public"."investor_risk_profiles"("wallet_address")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_investor_risk_profiles_tier" ON "public"."investor_risk_profiles"("tier")
    `);

    logger.info("migration.table_created", { table: "investor_risk_profiles" });
  }
}
