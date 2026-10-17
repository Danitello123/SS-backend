import { MigrationInterface, QueryRunner } from "typeorm";
import { logger } from "../observability/logger";
import { AppError } from "../utils/http-error";

const MIGRATION_NAME = "CreateInvoiceDraftsTable1754300000000";

/**
 * Creates table for invoice drafts with auto-expiration.
 *
 * - invoice_drafts: stores draft invoice form state with auto-expiration after 30 days
 */
export class CreateInvoiceDraftsTable1754300000000 implements MigrationInterface {
  name = MIGRATION_NAME;

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      logger.info("migration.start", { name: MIGRATION_NAME, direction: "up" });

      await this.ensureTable(queryRunner, "invoice_drafts", this.createInvoiceDraftsTable);

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

      await this.dropTable(queryRunner, "invoice_drafts");

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

  private async createInvoiceDraftsTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public"."invoice_drafts" (
        "id" VARCHAR(64) PRIMARY KEY,
        "seller_id" VARCHAR(64) NOT NULL,
        "seller_wallet" VARCHAR(56) NOT NULL,
        "draft_data" JSONB NOT NULL,
        "last_saved_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_invoice_drafts_seller_id" ON "public"."invoice_drafts"("seller_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_invoice_drafts_seller_wallet" ON "public"."invoice_drafts"("seller_wallet")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_invoice_drafts_expires_at" ON "public"."invoice_drafts"("expires_at")
    `);

    logger.info("migration.table_created", { table: "invoice_drafts" });
  }
}
