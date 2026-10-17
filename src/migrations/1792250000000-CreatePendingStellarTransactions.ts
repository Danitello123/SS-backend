import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePendingStellarTransactions1792250000000 implements MigrationInterface {
  name = "CreatePendingStellarTransactions1792250000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pending_stellar_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "transaction_hash" character varying(64) NOT NULL,
        "contract_id" character varying(56) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
        "ledger" integer,
        "last_checked_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pending_stellar_transactions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_pending_stellar_transaction_hash_contract"
      ON "pending_stellar_transactions" ("transaction_hash", "contract_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pending_stellar_transaction_status_created"
      ON "pending_stellar_transactions" ("status", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_pending_stellar_transaction_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_pending_stellar_transaction_hash_contract"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_stellar_transactions"`);
  }
}
