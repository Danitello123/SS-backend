import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInvoiceDocuments1731900000000 implements MigrationInterface {
  name = "AddInvoiceDocuments1731900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "invoice_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL,
        "cid" character varying(128) NOT NULL,
        "doc_type" character varying(64) NOT NULL DEFAULT 'general',
        "filename" character varying(255) NOT NULL,
        "mime_type" character varying(128) NOT NULL,
        "file_size" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoice_documents_invoice_id" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_invoice_documents_invoice_id" ON "invoice_documents" ("invoice_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_invoice_documents_invoice_id"`);
    await queryRunner.query(`DROP TABLE "invoice_documents"`);
  }
}
