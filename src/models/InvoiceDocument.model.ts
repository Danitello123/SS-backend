import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";

/**
 * One uploaded document for an invoice (issue #589).
 *
 * `Invoice.ipfsHash` only ever held a single CID -- each new upload
 * overwrote it. This table lets an invoice carry several typed documents
 * (invoice PDF, proof of delivery, purchase order, ...) so the bulk export
 * endpoint has more than one file to package.
 */
@Entity("invoice_documents")
export class InvoiceDocument {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "invoice_id", type: "uuid" })
  @Index("idx_invoice_documents_invoice_id")
  invoiceId!: string;

  @Column({ name: "cid", type: "varchar", length: 128 })
  cid!: string;

  @Column({ name: "doc_type", type: "varchar", length: 64, default: "general" })
  docType!: string;

  @Column({ name: "filename", type: "varchar", length: 255 })
  filename!: string;

  @Column({ name: "mime_type", type: "varchar", length: 128 })
  mimeType!: string;

  @Column({ name: "file_size", type: "integer" })
  fileSize!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne("Invoice", { onDelete: "CASCADE" })
  @JoinColumn({ name: "invoice_id" })
  invoice!: import("./Invoice.model").Invoice;
}
