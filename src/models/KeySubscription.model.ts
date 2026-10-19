import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * Tracks a subscriber's key-based subscription for status and expiry notification dispatch.
 */
@Entity("key_subscriptions")
@Index("idx_key_subscriptions_wallet_key", ["wallet", "keyId"], { unique: true })
export class KeySubscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Subscriber wallet address (Stellar G-address) */
  @Column({ name: "wallet", type: "varchar", length: 56 })
  @Index("idx_key_subscriptions_wallet")
  wallet!: string;

  /** Gated key identifier or Soroban contract address */
  @Column({ name: "key_id", type: "varchar", length: 128 })
  @Index("idx_key_subscriptions_key_id")
  keyId!: string;

  /** Human-readable key name (e.g. "VIP Access Pass") */
  @Column({ name: "key_name", type: "varchar", length: 255, nullable: true })
  keyName!: string | null;

  /** Minimum token holding required to keep the subscription active */
  @Column({ name: "min_holding", type: "decimal", precision: 30, scale: 7, default: "0" })
  minHolding!: string;

  /** Cached or last observed token balance of the subscriber */
  @Column({ name: "current_balance", type: "decimal", precision: 30, scale: 7, nullable: true })
  currentBalance!: string | null;

  /** Ledger at which access lapses; null when subscription does not expire */
  @Column({ name: "expiry_ledger", type: "integer", nullable: true })
  expiryLedger!: number | null;

  /** Expiry timestamp if known / computed */
  @Column({ name: "expiry_date", type: "timestamptz", nullable: true })
  @Index("idx_key_subscriptions_expiry_date")
  expiryDate!: Date | null;

  /** Last notified cycle identifier (prevents duplicate notification in same cycle) */
  @Column({ name: "last_notified_cycle", type: "varchar", length: 255, nullable: true })
  lastNotifiedCycle!: string | null;

  /** Last notified window ("7d" or "24h") */
  @Column({ name: "last_notified_window", type: "varchar", length: 32, nullable: true })
  lastNotifiedWindow!: string | null;

  /** True while the subscription is active */
  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
