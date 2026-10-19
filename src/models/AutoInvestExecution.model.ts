import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { AutoInvestExecutionStatus } from "../types/enums";

/**
 * The "AutoInvestExecuted" event record the issue's acceptance criteria
 * asks for: one row per rule whose match criteria passed for one invoice,
 * whatever happened next. Recording the insufficient-balance/failed cases
 * too (not only successful executions) is deliberate -- an investor needs
 * to see *why* a rule didn't fire, not just silence. A rule whose criteria
 * simply didn't match the invoice produces no row at all.
 */
@Entity("auto_invest_executions")
export class AutoInvestExecution {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "rule_id", type: "uuid" })
  @Index("idx_auto_invest_executions_rule_id")
  ruleId!: string;

  @Column({ name: "investor_id", type: "uuid" })
  @Index("idx_auto_invest_executions_investor_id")
  investorId!: string;

  @Column({ name: "invoice_id", type: "uuid" })
  @Index("idx_auto_invest_executions_invoice_id")
  invoiceId!: string;

  /** Set only when `status` is EXECUTED. */
  @Column({ name: "investment_id", type: "uuid", nullable: true })
  investmentId!: string | null;

  /** Amount invested when EXECUTED; the amount that would have been invested, for FAILED/SKIPPED. */
  @Column({ type: "decimal", precision: 18, scale: 4 })
  amount!: string;

  @Column({ type: "enum", enum: AutoInvestExecutionStatus })
  @Index("idx_auto_invest_executions_status")
  status!: AutoInvestExecutionStatus;

  /** Why a SKIPPED/FAILED execution didn't invest; `null` for EXECUTED. */
  @Column({ type: "varchar", length: 255, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: "executed_at" })
  executedAt!: Date;

  @ManyToOne("AutoInvestRule", { onDelete: "CASCADE" })
  @JoinColumn({ name: "rule_id" })
  rule!: import("./AutoInvestRule.model").AutoInvestRule;

  @ManyToOne("Invoice", { onDelete: "CASCADE" })
  @JoinColumn({ name: "invoice_id" })
  invoice!: import("./Invoice.model").Invoice;
}
