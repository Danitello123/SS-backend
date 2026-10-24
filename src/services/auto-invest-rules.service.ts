import { DataSource } from "typeorm";
import { Decimal } from "decimal.js";
import { AutoInvestRule } from "../models/AutoInvestRule.model";
import { RiskTier } from "../types/enums";
import { ServiceError } from "../utils/service-error";

export interface CreateAutoInvestRuleInput {
  investorId: string;
  category?: string | null;
  minYield: string;
  maxFaceValue: string;
  riskTier?: RiskTier | null;
  maxPerInvoice: string;
  minWalletBalance?: string;
}

/**
 * CRUD for investor-configured `AutoInvestRule`s (issue #596). Evaluating
 * and executing rules against a published invoice is
 * `AutoInvestRuleEngineService`'s job, not this one's -- this is only the
 * management surface a rule's owner uses to create, list and remove them.
 */
export class AutoInvestRulesService {
  constructor(private readonly dataSource: DataSource) {}

  async createRule(input: CreateAutoInvestRuleInput): Promise<AutoInvestRule> {
    const minYield = new Decimal(input.minYield);
    const maxFaceValue = new Decimal(input.maxFaceValue);
    const maxPerInvoice = new Decimal(input.maxPerInvoice);
    const minWalletBalance = new Decimal(input.minWalletBalance ?? "0");

    if (minYield.isNegative()) {
      throw new ServiceError("INVALID_MIN_YIELD", "minYield must not be negative");
    }
    if (maxFaceValue.isNegative() || maxFaceValue.isZero()) {
      throw new ServiceError("INVALID_MAX_FACE_VALUE", "maxFaceValue must be greater than zero");
    }
    if (maxPerInvoice.isNegative() || maxPerInvoice.isZero()) {
      throw new ServiceError("INVALID_MAX_PER_INVOICE", "maxPerInvoice must be greater than zero");
    }
    if (minWalletBalance.isNegative()) {
      throw new ServiceError("INVALID_MIN_WALLET_BALANCE", "minWalletBalance must not be negative");
    }

    const repo = this.dataSource.getRepository(AutoInvestRule);
    const rule = repo.create({
      investorId: input.investorId,
      category: input.category ?? null,
      minYield: minYield.toFixed(2),
      maxFaceValue: maxFaceValue.toFixed(4),
      riskTier: input.riskTier ?? null,
      maxPerInvoice: maxPerInvoice.toFixed(4),
      minWalletBalance: minWalletBalance.toFixed(4),
      enabled: true,
    });
    return repo.save(rule);
  }

  async listRules(investorId: string): Promise<AutoInvestRule[]> {
    return this.dataSource.getRepository(AutoInvestRule).find({ where: { investorId } });
  }

  async deleteRule(investorId: string, ruleId: string): Promise<void> {
    const repo = this.dataSource.getRepository(AutoInvestRule);
    const rule = await repo.findOneBy({ id: ruleId });
    if (!rule) {
      throw new ServiceError("RULE_NOT_FOUND", "Auto-invest rule not found", 404);
    }
    if (rule.investorId !== investorId) {
      throw new ServiceError("RULE_FORBIDDEN", "You can only delete your own auto-invest rules", 403);
    }
    await repo.remove(rule);
  }
}

export function createAutoInvestRulesService(dataSource: DataSource): AutoInvestRulesService {
  return new AutoInvestRulesService(dataSource);
}
