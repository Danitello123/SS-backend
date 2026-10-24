import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum FraudReportStatus {
  OPEN = "open",
  INVESTIGATING = "investigating",
  RESOLVED = "resolved",
  DISMISSED = "dismissed",
}

@Entity("invoice_fraud_reports")
@Index("uq_invoice_fraud_report_wallet", ["invoiceId", "reporterWallet"], { unique: true })
@Index("idx_invoice_fraud_report_status", ["status", "createdAt"])
export class InvoiceFraudReport {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "invoice_id", type: "uuid" })
  invoiceId!: string;

  @Column({ name: "reporter_wallet", type: "varchar", length: 56 })
  reporterWallet!: string;

  @Column({ type: "varchar", length: 64 })
  reason!: string;

  @Column({ type: "text" })
  detail!: string;

  @Column({ type: "varchar", length: 32, default: FraudReportStatus.OPEN })
  status!: FraudReportStatus;

  @Column({ name: "review_note", type: "text", nullable: true })
  reviewNote!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
