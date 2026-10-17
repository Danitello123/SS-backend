import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUniqueStellarPaymentIdentity1792240000000 implements MigrationInterface {
  name = "AddUniqueStellarPaymentIdentity1792240000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "investments"
      SET "transaction_hash" = UPPER("transaction_hash")
      WHERE "transaction_hash" IS NOT NULL;
    `);

    await queryRunner.query(`
      UPDATE "transactions"
      SET "stellar_tx_hash" = UPPER("stellar_tx_hash")
      WHERE "stellar_tx_hash" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_investments_stellar_payment"
      ON "investments" ("transaction_hash", "stellar_operation_index")
      WHERE "transaction_hash" IS NOT NULL AND "stellar_operation_index" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_transactions_stellar_payment"
      ON "transactions" ("stellar_tx_hash", "stellar_operation_index")
      WHERE "stellar_tx_hash" IS NOT NULL AND "stellar_operation_index" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_transactions_stellar_payment";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_investments_stellar_payment";`);
  }
}
