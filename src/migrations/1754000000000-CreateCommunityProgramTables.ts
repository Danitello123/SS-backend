import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateCommunityProgramTables1754000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: "invoice_fraud_reports",
      columns: [
        { name: "id", type: "uuid", isPrimary: true, generationStrategy: "uuid", isGenerated: true },
        { name: "invoice_id", type: "uuid" }, { name: "reporter_wallet", type: "varchar", length: "56" },
        { name: "reason", type: "varchar", length: "64" }, { name: "detail", type: "text" },
        { name: "status", type: "varchar", length: "32", default: "'open'" },
        { name: "review_note", type: "text", isNullable: true },
        { name: "created_at", type: "timestamp with time zone", default: "now()" },
        { name: "updated_at", type: "timestamp with time zone", default: "now()" },
      ],
    }), true);
    await queryRunner.createIndex("invoice_fraud_reports", new TableIndex({ name: "uq_invoice_fraud_report_wallet", columnNames: ["invoice_id", "reporter_wallet"], isUnique: true }));
    await queryRunner.createTable(new Table({
      name: "referrals",
      columns: [
        { name: "id", type: "uuid", isPrimary: true, generationStrategy: "uuid", isGenerated: true },
        { name: "referrer_wallet", type: "varchar", length: "56" }, { name: "referee_wallet", type: "varchar", length: "56" },
        { name: "earned_amount", type: "decimal", precision: 18, scale: 4, default: 0 },
        { name: "claimed_amount", type: "decimal", precision: 18, scale: 4, default: 0 },
        { name: "created_at", type: "timestamp with time zone", default: "now()" },
      ],
    }), true);
    await queryRunner.createIndex("referrals", new TableIndex({ name: "uq_referral_referee", columnNames: ["referee_wallet"], isUnique: true }));
    await queryRunner.createTable(new Table({
      name: "waitlist_entries",
      columns: [
        { name: "id", type: "uuid", isPrimary: true, generationStrategy: "uuid", isGenerated: true },
        { name: "wallet", type: "varchar", length: "56" }, { name: "email", type: "varchar", length: "255" },
        { name: "referral_code", type: "varchar", length: "64" }, { name: "referral_count", type: "integer", default: 0 },
        { name: "status", type: "varchar", length: "24", default: "'pending'" },
        { name: "created_at", type: "timestamp with time zone", default: "now()" },
        { name: "updated_at", type: "timestamp with time zone", default: "now()" },
      ],
    }), true);
    await queryRunner.createIndex("waitlist_entries", new TableIndex({ name: "uq_waitlist_wallet", columnNames: ["wallet"], isUnique: true }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("waitlist_entries", true);
    await queryRunner.dropTable("referrals", true);
    await queryRunner.dropTable("invoice_fraud_reports", true);
  }
}
