import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoInvest1731910000000 implements MigrationInterface {
  name = "AddAutoInvest1731910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoices" ADD "category" character varying(64);
      CREATE INDEX "idx_invoices_category" ON "invoices" ("category");
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."auto_invest_rules_risktier_enum" AS ENUM('low', 'medium', 'high');

      CREATE TABLE "auto_invest_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "investor_id" uuid NOT NULL,
        "category" character varying(64),
        "min_yield" decimal(5,2) NOT NULL,
        "max_face_value" decimal(18,4) NOT NULL,
        "risk_tier" "public"."auto_invest_rules_risktier_enum",
        "max_per_invoice" decimal(18,4) NOT NULL,
        "min_wallet_balance" decimal(18,4) NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auto_invest_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auto_invest_rules_investor_id" FOREIGN KEY ("investor_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      );

      CREATE INDEX "idx_auto_invest_rules_investor_id" ON "auto_invest_rules" ("investor_id");
      CREATE INDEX "idx_auto_invest_rules_enabled" ON "auto_invest_rules" ("enabled");
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."auto_invest_executions_status_enum" AS ENUM('executed', 'skipped_insufficient_balance', 'failed');

      CREATE TABLE "auto_invest_executions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "rule_id" uuid NOT NULL,
        "investor_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "investment_id" uuid,
        "amount" decimal(18,4) NOT NULL,
        "status" "public"."auto_invest_executions_status_enum" NOT NULL,
        "reason" character varying(255),
        "executed_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auto_invest_executions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auto_invest_executions_rule_id" FOREIGN KEY ("rule_id")
          REFERENCES "auto_invest_rules" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auto_invest_executions_invoice_id" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices" ("id") ON DELETE CASCADE
      );

      CREATE INDEX "idx_auto_invest_executions_rule_id" ON "auto_invest_executions" ("rule_id");
      CREATE INDEX "idx_auto_invest_executions_investor_id" ON "auto_invest_executions" ("investor_id");
      CREATE INDEX "idx_auto_invest_executions_invoice_id" ON "auto_invest_executions" ("invoice_id");
      CREATE INDEX "idx_auto_invest_executions_status" ON "auto_invest_executions" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auto_invest_executions"`);
    await queryRunner.query(`DROP TYPE "public"."auto_invest_executions_status_enum"`);
    await queryRunner.query(`DROP TABLE "auto_invest_rules"`);
    await queryRunner.query(`DROP TYPE "public"."auto_invest_rules_risktier_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_invoices_category"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "category"`);
  }
}
