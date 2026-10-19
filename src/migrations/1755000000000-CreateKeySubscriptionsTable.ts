import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateKeySubscriptionsTable1755000000000 implements MigrationInterface {
  name = "CreateKeySubscriptionsTable1755000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "key_subscriptions",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "uuid",
          },
          {
            name: "wallet",
            type: "varchar",
            length: "56",
            isNullable: false,
          },
          {
            name: "key_id",
            type: "varchar",
            length: "128",
            isNullable: false,
          },
          {
            name: "key_name",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "min_holding",
            type: "decimal",
            precision: 30,
            scale: 7,
            default: "'0'",
          },
          {
            name: "current_balance",
            type: "decimal",
            precision: 30,
            scale: 7,
            isNullable: true,
          },
          {
            name: "expiry_ledger",
            type: "integer",
            isNullable: true,
          },
          {
            name: "expiry_date",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "last_notified_cycle",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "last_notified_window",
            type: "varchar",
            length: "32",
            isNullable: true,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true
    );

    await queryRunner.createIndices("key_subscriptions", [
      new TableIndex({
        name: "idx_key_subscriptions_wallet",
        columnNames: ["wallet"],
      }),
      new TableIndex({
        name: "idx_key_subscriptions_key_id",
        columnNames: ["key_id"],
      }),
      new TableIndex({
        name: "idx_key_subscriptions_expiry_date",
        columnNames: ["expiry_date"],
      }),
      new TableIndex({
        name: "idx_key_subscriptions_wallet_key",
        columnNames: ["wallet", "key_id"],
        isUnique: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("key_subscriptions", true);
  }
}
