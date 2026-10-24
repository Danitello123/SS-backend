import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddSorobanEscrowFieldsToInvoice1710000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "invoices",
      new TableColumn({
        name: "soroban_contract_id",
        type: "varchar",
        length: "56",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "invoices",
      new TableColumn({
        name: "onchain_status",
        type: "simple-enum",
        enum: ["UNINITIALIZED", "ACTIVE", "SETTLED", "REFUNDED", "PAUSED"],
        default: "'UNINITIALIZED'",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "invoices",
      new TableColumn({
        name: "creation_tx_hash",
        type: "varchar",
        length: "64",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "invoices",
      new TableColumn({
        name: "last_synced_ledger",
        type: "bigint",
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("invoices", "last_synced_ledger");
    await queryRunner.dropColumn("invoices", "creation_tx_hash");
    await queryRunner.dropColumn("invoices", "onchain_status");
    await queryRunner.dropColumn("invoices", "soroban_contract_id");
  }
}
