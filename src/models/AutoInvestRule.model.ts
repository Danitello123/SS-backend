import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { RiskTier } from "../types/enums";

/**
 * An investor-configured auto-invest rule (issue #596). On every invoice
 * that goes PUBLISHED, every enabled rule is evaluated against it; a match
 * invests `min(maxPerInvoice, invoice's remaining capacity)` on the
 * investor's behalf, provided their wallet balance clears
 * `minWalletBalance`.
 */
@Entity("auto_invest_rules")
export class AutoInvestRule {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "investor_id", type: "uuid" })
  @Index("idx_auto_invest_rules_investor_id")
  investorId!: string;

  /** `null` matches any category. */
  @Column({ name: "category", type: "varchar", length: 64, nullable: true })
  category!: string | null;

  /** Minimum acceptable yield, as a percentage matched against `invoice.discountRate`. */
  @Column({ name: "min_yield", type: "decimal", precision: 5, scale: 2 })
  minYield!: string;

  @Column({ name: "max_face_value", type: "decimal", precision: 18, scale: 4 })
  maxFaceValue!: string;

  /** `null` matches any risk tier. */
  @Column({ name: "risk_tier", type: "enum", enum: RiskTier, nullable: true })
  riskTier!: RiskTier | null;

  /** Cap on how much this rule will commit to a single invoice. */
  @Column({ name: "max_per_invoice", type: "decimal", precision: 18, scale: 4 })
  maxPerInvoice!: string;

  /** Rule is skipped (not disabled, just not executed this time) while the
   * investor's wallet balance is below this. */
  @Column({ name: "min_wallet_balance", type: "decimal", precision: 18, scale: 4, default: 0 })
  minWalletBalance!: string;

  @Column({ name: "enabled", type: "boolean", default: true })
  @Index("idx_auto_invest_rules_enabled")
  enabled!: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "investor_id" })
  investor!: import("./User.model").User;
}
