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

@Entity("fee_schedules")
@Index("idx_fee_schedules_is_active", ["isActive"])
@Index("idx_fee_schedules_effective_dates", ["effectiveFrom", "effectiveUntil"])
export class FeeSchedule {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "investment_fee_bps", type: "int", default: 100 })
  investmentFeeBps!: number;

  @Column({ name: "settlement_fee_bps", type: "int", default: 50 })
  settlementFeeBps!: number;

  @Column({ name: "platform_fee_bps", type: "int", default: 100 })
  platformFeeBps!: number;

  @Column({ name: "secondary_market_fee_bps", type: "int", default: 150 })
  secondaryMarketFeeBps!: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "effective_from", type: "timestamptz", default: () => "NOW()" })
  effectiveFrom!: Date;

  @Column({ name: "effective_until", type: "timestamptz", nullable: true })
  effectiveUntil!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToMany("FeeScheduleHistory", "feeSchedule")
  history?: FeeScheduleHistory[];
}

@Entity("fee_schedule_history")
@Index("idx_fee_schedule_history_schedule_id", ["feeScheduleId"])
@Index("idx_fee_schedule_history_created_at", ["createdAt"])
@Index("idx_fee_schedule_history_actor", ["actorWallet"])
export class FeeScheduleHistory {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "fee_schedule_id", type: "int" })
  feeScheduleId!: number;

  @Column({ name: "actor_wallet", type: "varchar", length: 56 })
  actorWallet!: string;

  @Column({ name: "actor_role", type: "varchar", length: 50, default: "admin" })
  actorRole!: string;

  @Column({ name: "old_investment_fee_bps", type: "int", nullable: true })
  oldInvestmentFeeBps!: number | null;

  @Column({ name: "old_settlement_fee_bps", type: "int", nullable: true })
  oldSettlementFeeBps!: number | null;

  @Column({ name: "old_platform_fee_bps", type: "int", nullable: true })
  oldPlatformFeeBps!: number | null;

  @Column({ name: "old_secondary_market_fee_bps", type: "int", nullable: true })
  oldSecondaryMarketFeeBps!: number | null;

  @Column({ name: "new_investment_fee_bps", type: "int" })
  newInvestmentFeeBps!: number;

  @Column({ name: "new_settlement_fee_bps", type: "int" })
  newSettlementFeeBps!: number;

  @Column({ name: "new_platform_fee_bps", type: "int" })
  newPlatformFeeBps!: number;

  @Column({ name: "new_secondary_market_fee_bps", type: "int" })
  newSecondaryMarketFeeBps!: number;

  @Column({ name: "change_reason", type: "text", nullable: true })
  changeReason!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne("FeeSchedule", "history")
  @JoinColumn({ name: "fee_schedule_id" })
  feeSchedule!: FeeSchedule;
}
