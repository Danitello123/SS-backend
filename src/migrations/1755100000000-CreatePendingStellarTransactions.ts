import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePendingStellarTransactions1755100000000 implements MigrationInterface {
  name = "CreatePendingStellarTransactions1755100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pending_stellar_transactions" (
        "stellar_tx_hash" varchar(64) PRIMARY KEY,
        "contract_id" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
        "submitted_at" timestamptz NOT NULL,
        "last_checked_at" timestamptz,
        "confirmed_ledger" bigint,
        "failure_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pending_stellar_transactions_status_created"
      ON "pending_stellar_transactions" ("status", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_pending_stellar_transactions_status_created";`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_stellar_transactions";`);
  }
}
