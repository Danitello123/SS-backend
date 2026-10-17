import { DataSource } from "typeorm";
import { Decimal } from "decimal.js";
import { Invoice } from "../models/Invoice.model";
import { AutoInvestRule } from "../models/AutoInvestRule.model";
import { AutoInvestExecution } from "../models/AutoInvestExecution.model";
import { User } from "../models/User.model";
import { AutoInvestExecutionStatus, RiskTier } from "../types/enums";
import { ServiceError } from "../utils/service-error";
import type { AppLogger } from "../observability/logger";
import type { InvestmentService } from "./investment.service";
import type { AccountBalanceChecker } from "./stellar/account-balance.service";

/** `Invoice.riskScore` (0-100, lower is safer) banded into the tiers a rule can require. */
function riskTierFor(riskScore: string | null): RiskTier | null {
  if (riskScore === null) return null;
  const score = new Decimal(riskScore);
  if (score.lte(30)) return RiskTier.LOW;
  if (score.lte(70)) return RiskTier.MEDIUM;
  return RiskTier.HIGH;
}

function matches(rule: AutoInvestRule, invoice: Invoice): boolean {
  if (rule.category !== null && rule.category !== invoice.category) return false;
  if (new Decimal(invoice.discountRate).lt(rule.minYield)) return false;
  if (new Decimal(invoice.amount).gt(rule.maxFaceValue)) return false;
  if (rule.riskTier !== null && rule.riskTier !== riskTierFor(invoice.riskScore)) return false;
  return true;
}

export interface AutoInvestRuleEngineDependencies {
  dataSource: DataSource;
  investmentService: InvestmentService;
  balanceChecker: AccountBalanceChecker;
  logger: AppLogger;
}

/**
 * Evaluates every enabled `AutoInvestRule` against an invoice that just went
 * PUBLISHED (issue #596), investing on a matching rule's behalf unless the
 * investor's wallet balance is below that rule's `minWalletBalance`.
 *
 * Each matching rule executes independently -- two rules belonging to the
 * same investor (or different investors) that both match this invoice each
 * get their own `createInvestment` call and their own `AutoInvestExecution`
 * row, so one failing (e.g. the invoice became fully funded partway
 * through) never prevents the other from running.
 */
export class AutoInvestRuleEngineService {
  constructor(private readonly dependencies: AutoInvestRuleEngineDependencies) {}

  async evaluateInvoice(invoice: Invoice): Promise<void> {
    const rules = await this.dependencies.dataSource
      .getRepository(AutoInvestRule)
      .find({ where: { enabled: true } });

    const matching = rules.filter((rule) => matches(rule, invoice));

    for (const rule of matching) {
      await this.executeRule(rule, invoice);
    }
  }

  private async executeRule(rule: AutoInvestRule, invoice: Invoice): Promise<void> {
    const amount = Decimal.min(new Decimal(rule.maxPerInvoice), new Decimal(invoice.netAmount));

    try {
      const investor = await this.dependencies.dataSource.getRepository(User).findOneBy({ id: rule.investorId });
      if (!investor) {
        await this.recordExecution(rule, invoice, amount, AutoInvestExecutionStatus.FAILED, "Investor not found");
        return;
      }

      const balance = await this.dependencies.balanceChecker.getBalance(investor.stellarAddress);
      if (balance.lt(rule.minWalletBalance)) {
        await this.recordExecution(
          rule,
          invoice,
          amount,
          AutoInvestExecutionStatus.SKIPPED_INSUFFICIENT_BALANCE,
          `Wallet balance ${balance.toString()} is below the rule's minimum ${rule.minWalletBalance}`,
        );
        return;
      }

      const investment = await this.dependencies.investmentService.createInvestment({
        invoiceId: invoice.id,
        investorId: rule.investorId,
        investmentAmount: amount.toFixed(4),
      });

      await this.recordExecution(rule, invoice, amount, AutoInvestExecutionStatus.EXECUTED, null, investment.id);

      this.dependencies.logger.info("AutoInvestExecuted", {
        rule_id: rule.id,
        invoice_id: invoice.id,
        investment_id: investment.id,
        investor_id: rule.investorId,
        amount: amount.toFixed(4),
      });
    } catch (error) {
      const message =
        error instanceof ServiceError || error instanceof Error ? error.message : "Unknown error";
      await this.recordExecution(rule, invoice, amount, AutoInvestExecutionStatus.FAILED, message);

      this.dependencies.logger.warn("Auto-invest execution failed", {
        rule_id: rule.id,
        invoice_id: invoice.id,
        error_reason: message,
      });
    }
  }

  private async recordExecution(
    rule: AutoInvestRule,
    invoice: Invoice,
    amount: Decimal,
    status: AutoInvestExecutionStatus,
    reason: string | null,
    investmentId: string | null = null,
  ): Promise<void> {
    const execution = this.dependencies.dataSource.getRepository(AutoInvestExecution).create({
      ruleId: rule.id,
      investorId: rule.investorId,
      invoiceId: invoice.id,
      investmentId,
      amount: amount.toFixed(4),
      status,
      reason,
    });
    await this.dependencies.dataSource.getRepository(AutoInvestExecution).save(execution);
  }
}

export function createAutoInvestRuleEngineService(
  dependencies: AutoInvestRuleEngineDependencies,
): AutoInvestRuleEngineService {
  return new AutoInvestRuleEngineService(dependencies);
}
