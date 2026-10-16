import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { InvoiceStatus } from "../types/enums";

@Entity("invoices")
export class Invoice {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "seller_id", type: "uuid" })
  @Index("idx_invoices_seller_id")
  sellerId!: string;

  @Column({ name: "invoice_number", type: "varchar", length: 64 })
  @Index("idx_invoices_invoice_number", { unique: true })
  invoiceNumber!: string;

  @Column({ name: "customer_name", type: "varchar", length: 255 })
  customerName!: string;

  @Column({ type: "decimal", precision: 18, scale: 4, default: 0 })
  amount!: string;

  @Column({ name: "discount_rate", type: "decimal", precision: 5, scale: 2, default: 0 })
  discountRate!: string;

  @Column({ name: "net_amount", type: "decimal", precision: 18, scale: 4, default: 0 })
  netAmount!: string;

  @Column({ name: "due_date", type: "date" })
  @Index("idx_invoices_due_date")
  dueDate!: Date;

  @Column({ name: "ipfs_hash", type: "varchar", length: 128, nullable: true })
  ipfsHash!: string | null;

  @Column({ name: "risk_score", type: "decimal", precision: 5, scale: 2, nullable: true })
  riskScore!: string | null;

  /** Invoice category/industry (e.g. "logistics", "retail"), used to match
   * against auto-invest rule criteria (issue #596). Freeform; not an enum,
   * since issuers list many industries and this isn't validated elsewhere yet. */
  @Column({ name: "category", type: "varchar", length: 64, nullable: true })
  @Index("idx_invoices_category")
  category!: string | null;

  @Column({
    type: "enum",
    enum: InvoiceStatus,
    default: InvoiceStatus.DRAFT,
  })
  @Index("idx_invoices_status")
  status!: InvoiceStatus;

  @Column({ name: "smart_contract_id", type: "varchar", length: 64, nullable: true })
  smartContractId!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at" })
  deletedAt!: Date | null;

  @ManyToOne("User", "invoices", { onDelete: "CASCADE" })
  @JoinColumn({ name: "seller_id" })
  seller!: import("./User.model").User;

  @OneToMany("Investment", "invoice")
  investments!: import("./Investment.model").Investment[];

  @OneToMany("Transaction", "invoice")
  transactions!: import("./Transaction.model").Transaction[];
}
