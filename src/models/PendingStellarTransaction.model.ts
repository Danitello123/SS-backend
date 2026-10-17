import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type PendingStellarTransactionStatus =
  | "PENDING_CONFIRMATION"
  | "COMPLETED"
  | "FAILED";

@Entity("pending_stellar_transactions")
@Index("uq_pending_stellar_transaction_hash_contract", ["transactionHash", "contractId"], {
  unique: true,
})
@Index("idx_pending_stellar_transaction_status_created", ["status", "createdAt"])
export class PendingStellarTransaction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "transaction_hash", type: "varchar", length: 64 })
  transactionHash!: string;

  @Column({ name: "contract_id", type: "varchar", length: 56 })
  contractId!: string;

  @Column({ type: "varchar", length: 32, default: "PENDING_CONFIRMATION" })
  status!: PendingStellarTransactionStatus;

  @Column({ type: "integer", nullable: true })
  ledger!: number | null;

  @Column({ name: "last_checked_at", type: "timestamptz", nullable: true })
  lastCheckedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
