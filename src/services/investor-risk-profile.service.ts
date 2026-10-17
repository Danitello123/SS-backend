import { DataSource } from "typeorm";
import { InvestorRiskProfile, RiskTier, InvestmentExperience, TimeHorizon, RiskTolerance, InvoiceRiskCategory } from "../models/InvestorRiskProfile.model";
import { ServiceError } from "../utils/service-error";
import { logger } from "../observability/logger";

export interface RiskProfileInput {
  investmentExperience: InvestmentExperience;
  timeHorizon: TimeHorizon;
  riskTolerance: RiskTolerance;
  annualIncomeRange: string;
  netWorthRange: string;
  investmentObjective: string;
  lossTolerancePercentage: number;
}

export interface RiskProfileResponse {
  walletAddress: string;
  tier: RiskTier;
  responses: RiskProfileInput;
  lastUpdated: Date;
}

const TIER_RULES = {
  CONSERVATIVE: {
    allowedInvoiceRisks: ["low"] as InvoiceRiskCategory[],
    minScore: 0,
    maxScore: 33,
  },
  MODERATE: {
    allowedInvoiceRisks: ["low", "medium"] as InvoiceRiskCategory[],
    minScore: 34,
    maxScore: 66,
  },
  AGGRESSIVE: {
    allowedInvoiceRisks: ["low", "medium", "high"] as InvoiceRiskCategory[],
    minScore: 67,
    maxScore: 100,
  },
};

export class InvestorRiskProfileService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Computes risk tier from questionnaire responses.
   * Score is weighted: 30% experience, 25% time horizon, 25% risk tolerance, 20% loss tolerance.
   */
  private computeTier(responses: RiskProfileInput): RiskTier {
    let score = 0;

    // Investment experience (0-30 points)
    const experienceScores: Record<InvestmentExperience, number> = {
      none: 0,
      limited: 15,
      experienced: 30,
    };
    score += experienceScores[responses.investmentExperience];

    // Time horizon (0-25 points)
    const horizonScores: Record<TimeHorizon, number> = {
      short: 0,
      medium: 12,
      long: 25,
    };
    score += horizonScores[responses.timeHorizon];

    // Risk tolerance (0-25 points)
    const toleranceScores: Record<RiskTolerance, number> = {
      low: 0,
      medium: 12,
      high: 25,
    };
    score += toleranceScores[responses.riskTolerance];

    // Loss tolerance percentage (0-20 points)
    const lossScore = Math.min(responses.lossTolerancePercentage / 5, 20);
    score += lossScore;

    // Determine tier based on score
    if (score <= TIER_RULES.CONSERVATIVE.maxScore) return "conservative";
    if (score <= TIER_RULES.MODERATE.maxScore) return "moderate";
    return "aggressive";
  }

  /**
   * Validates questionnaire responses.
   */
  private validateResponses(responses: RiskProfileInput): void {
    if (!responses.investmentExperience || !["none", "limited", "experienced"].includes(responses.investmentExperience)) {
      throw new ServiceError("INVALID_RESPONSE", "Invalid investment experience", 400);
    }

    if (!responses.timeHorizon || !["short", "medium", "long"].includes(responses.timeHorizon)) {
      throw new ServiceError("INVALID_RESPONSE", "Invalid time horizon", 400);
    }

    if (!responses.riskTolerance || !["low", "medium", "high"].includes(responses.riskTolerance)) {
      throw new ServiceError("INVALID_RESPONSE", "Invalid risk tolerance", 400);
    }

    if (responses.lossTolerancePercentage < 0 || responses.lossTolerancePercentage > 100) {
      throw new ServiceError("INVALID_RESPONSE", "Loss tolerance must be between 0 and 100", 400);
    }

    if (!responses.annualIncomeRange || responses.annualIncomeRange.trim().length === 0) {
      throw new ServiceError("INVALID_RESPONSE", "Annual income range is required", 400);
    }

    if (!responses.netWorthRange || responses.netWorthRange.trim().length === 0) {
      throw new ServiceError("INVALID_RESPONSE", "Net worth range is required", 400);
    }

    if (!responses.investmentObjective || responses.investmentObjective.trim().length === 0) {
      throw new ServiceError("INVALID_RESPONSE", "Investment objective is required", 400);
    }
  }

  /**
   * Stores or updates risk profile for an investor.
   */
  async saveRiskProfile(walletAddress: string, responses: RiskProfileInput): Promise<RiskProfileResponse> {
    this.validateResponses(responses);

    const tier = this.computeTier(responses);

    const repository = this.dataSource.getRepository(InvestorRiskProfile);
    let profile = await repository.findOne({ where: { walletAddress } });

    if (profile) {
      // Update existing profile
      profile.tier = tier;
      profile.investmentExperience = responses.investmentExperience;
      profile.timeHorizon = responses.timeHorizon;
      profile.riskTolerance = responses.riskTolerance;
      profile.annualIncomeRange = responses.annualIncomeRange;
      profile.netWorthRange = responses.netWorthRange;
      profile.investmentObjective = responses.investmentObjective;
      profile.lossTolerancePercentage = responses.lossTolerancePercentage;
      profile = await repository.save(profile);

      logger.info("investor_risk_profile.updated", {
        wallet: walletAddress,
        tier,
      });
    } else {
      // Create new profile
      profile = repository.create({
        walletAddress,
        tier,
        ...responses,
      });
      profile = await repository.save(profile);

      logger.info("investor_risk_profile.created", {
        wallet: walletAddress,
        tier,
      });
    }

    return {
      walletAddress: profile.walletAddress,
      tier: profile.tier,
      responses: {
        investmentExperience: profile.investmentExperience,
        timeHorizon: profile.timeHorizon,
        riskTolerance: profile.riskTolerance,
        annualIncomeRange: profile.annualIncomeRange,
        netWorthRange: profile.netWorthRange,
        investmentObjective: profile.investmentObjective,
        lossTolerancePercentage: profile.lossTolerancePercentage,
      },
      lastUpdated: profile.updatedAt,
    };
  }

  /**
   * Gets risk profile for an investor.
   */
  async getRiskProfile(walletAddress: string): Promise<RiskProfileResponse | null> {
    const repository = this.dataSource.getRepository(InvestorRiskProfile);
    const profile = await repository.findOne({ where: { walletAddress } });

    if (!profile) {
      return null;
    }

    return {
      walletAddress: profile.walletAddress,
      tier: profile.tier,
      responses: {
        investmentExperience: profile.investmentExperience,
        timeHorizon: profile.timeHorizon,
        riskTolerance: profile.riskTolerance,
        annualIncomeRange: profile.annualIncomeRange,
        netWorthRange: profile.netWorthRange,
        investmentObjective: profile.investmentObjective,
        lossTolerancePercentage: profile.lossTolerancePercentage,
      },
      lastUpdated: profile.updatedAt,
    };
  }

  /**
   * Checks if an investor's tier allows investment in an invoice with given risk category.
   */
  async checkSuitability(walletAddress: string, invoiceRiskCategory: InvoiceRiskCategory): Promise<{
    suitable: boolean;
    tier: RiskTier | null;
    reason?: string;
  }> {
    const profile = await this.getRiskProfile(walletAddress);

    if (!profile) {
      return {
        suitable: false,
        tier: null,
        reason: "No risk profile found. Please complete the risk questionnaire.",
      };
    }

    const allowedRisks = TIER_RULES[profile.tier.toUpperCase() as keyof typeof TIER_RULES].allowedInvoiceRisks;

    if (!allowedRisks.includes(invoiceRiskCategory)) {
      return {
        suitable: false,
        tier: profile.tier,
        reason: `Your ${profile.tier} risk tier does not allow investment in ${invoiceRiskCategory} risk invoices.`,
      };
    }

    return {
      suitable: true,
      tier: profile.tier,
    };
  }

  /**
   * Deletes risk profile for an investor.
   */
  async deleteRiskProfile(walletAddress: string): Promise<void> {
    const repository = this.dataSource.getRepository(InvestorRiskProfile);
    const profile = await repository.findOne({ where: { walletAddress } });

    if (!profile) {
      throw new ServiceError("PROFILE_NOT_FOUND", "Risk profile not found", 404);
    }

    await repository.remove(profile);

    logger.info("investor_risk_profile.deleted", {
      wallet: walletAddress,
    });
  }
}

export function createInvestorRiskProfileService(dataSource: DataSource): InvestorRiskProfileService {
  return new InvestorRiskProfileService(dataSource);
}
