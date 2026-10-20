import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type PendingStellarTransactionStatus = "PENDING_CONFIRMATION" | "COMPLETED" | "FAILED";

@Entity("pending_stellar_transactions")
@Index("idx_pending_stellar_transactions_status_created", ["status", "createdAt"])
export class PendingStellarTransaction {
  @PrimaryColumn({ name: "stellar_tx_hash", type: "varchar", length: 64 })
  stellarTxHash!: string;

  @Column({ name: "contract_id", type: "varchar", length: 64 })
  contractId!: string;

  @Column({
    type: "varchar",
    length: 32,
    default: "PENDING_CONFIRMATION",
  })
  status!: PendingStellarTransactionStatus;

  @Column({ name: "submitted_at", type: "timestamptz" })
  submittedAt!: Date;

  @Column({ name: "last_checked_at", type: "timestamptz", nullable: true })
  lastCheckedAt!: Date | null;

  @Column({ name: "confirmed_ledger", type: "bigint", nullable: true })
  confirmedLedger!: string | null;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
