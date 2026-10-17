import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type RiskTier = "conservative" | "moderate" | "aggressive";
export type InvestmentExperience = "none" | "limited" | "experienced";
export type TimeHorizon = "short" | "medium" | "long";
export type RiskTolerance = "low" | "medium" | "high";

export type InvoiceRiskCategory = "low" | "medium" | "high";

@Entity("investor_risk_profiles")
@Index("idx_investor_risk_profiles_wallet", ["walletAddress"], { unique: true })
@Index("idx_investor_risk_profiles_tier", ["tier"])
export class InvestorRiskProfile {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "wallet_address", type: "varchar", length: 56, unique: true })
  walletAddress!: string;

  @Column({ type: "varchar", length: 20 })
  tier!: RiskTier;

  @Column({ name: "investment_experience", type: "varchar", length: 20 })
  investmentExperience!: InvestmentExperience;

  @Column({ name: "time_horizon", type: "varchar", length: 20 })
  timeHorizon!: TimeHorizon;

  @Column({ name: "risk_tolerance", type: "varchar", length: 20 })
  riskTolerance!: RiskTolerance;

  @Column({ name: "annual_income_range", type: "varchar", length: 30 })
  annualIncomeRange!: string;

  @Column({ name: "net_worth_range", type: "varchar", length: 30 })
  netWorthRange!: string;

  @Column({ name: "investment_objective", type: "varchar", length: 50 })
  investmentObjective!: string;

  @Column({ name: "loss_tolerance_percentage", type: "int" })
  lossTolerancePercentage!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
