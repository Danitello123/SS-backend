import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds support for admin rejection of invoices (issue #206):
 *  - a new "rejected" member on the invoices.status enum
 *  - a nullable "rejection_reason" text column to persist the admin's reason
 */
export class AddInvoiceRejection1732000000000 implements MigrationInterface {
  name = "AddInvoiceRejection1732000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres requires ALTER TYPE ... ADD VALUE to run outside of a
    // surrounding transaction in older versions; guard with IF NOT EXISTS
    // (supported since PG 9.6+) so this migration is safe to re-run.
    await queryRunner.query(`
      ALTER TYPE "public"."invoices_invoicestatus_enum" ADD VALUE IF NOT EXISTS 'rejected';
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices"
      ADD COLUMN IF NOT EXISTS "rejection_reason" text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres does not support removing a value from an enum type directly.
    // We only reverse the additive column; the enum value is left in place
    // (existing rows using it would otherwise have no valid status to fall
    // back to, and this mirrors this repo's other additive-only migrations).
    await queryRunner.query(`
      ALTER TABLE "invoices"
      DROP COLUMN IF EXISTS "rejection_reason";
    `);
  }
}
