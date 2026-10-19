import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from "typeorm";

export type ReputationTier = "poor" | "fair" | "good" | "excellent";

@Entity("issuer_reputations")
@Index("idx_issuer_reputations_wallet", ["walletAddress"], { unique: true })
@Index("idx_issuer_reputations_score", ["score"])
@Index("idx_issuer_reputations_tier", ["tier"])
export class IssuerReputation {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "wallet_address", type: "varchar", length: 56, unique: true })
  walletAddress!: string;

  @Column({ type: "int" })
  score!: number;

  @Column({ type: "varchar", length: 20 })
  tier!: ReputationTier;

  @Column({ name: "total_invoices_settled", type: "int", default: 0 })
  totalInvoicesSettled!: number;

  @Column({ name: "on_time_settlement_rate", type: "decimal", precision: 5, scale: 2, default: 0 })
  onTimeSettlementRate!: string;

  @Column({ name: "avg_days_late", type: "decimal", precision: 10, scale: 2, default: 0 })
  avgDaysLate!: string;

  @Column({ name: "avg_days_early", type: "decimal", precision: 10, scale: 2, default: 0 })
  avgDaysEarly!: string;

  @Column({ name: "last_settled_at", type: "timestamptz", nullable: true })
  lastSettledAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToMany("IssuerReputationHistory", "issuerReputation")
  history?: IssuerReputationHistory[];
}

@Entity("issuer_reputation_history")
@Index("idx_issuer_reputation_history_id", ["issuerReputationId"])
@Index("idx_issuer_reputation_history_created_at", ["createdAt"])
@Index("idx_issuer_reputation_history_invoice", ["invoiceId"])
export class IssuerReputationHistory {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "issuer_reputation_id", type: "int" })
  issuerReputationId!: number;

  @Column({ name: "old_score", type: "int", nullable: true })
  oldScore!: number | null;

  @Column({ name: "old_tier", type: "varchar", length: 20, nullable: true })
  oldTier!: string | null;

  @Column({ name: "new_score", type: "int" })
  newScore!: number;

  @Column({ name: "new_tier", type: "varchar", length: 20 })
  newTier!: string;

  @Column({ name: "invoice_id", type: "varchar", length: 64, nullable: true })
  invoiceId!: string | null;

  @Column({ name: "settlement_was_on_time", type: "boolean", nullable: true })
  settlementWasOnTime!: boolean | null;

  @Column({ name: "trigger_reason", type: "varchar", length: 100 })
  triggerReason!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne("IssuerReputation", "history")
  @JoinColumn({ name: "issuer_reputation_id" })
  issuerReputation!: IssuerReputation;
}
