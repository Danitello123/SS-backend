import { DataSource, EntityManager } from "typeorm";
import { IssuerReputation, IssuerReputationHistory, ReputationTier } from "../models/IssuerReputation.model";
import { Invoice } from "../models/Invoice.model";
import { logger } from "../observability/logger";
import Decimal from "decimal.js";

export interface ReputationScore {
  score: number;
  tier: ReputationTier;
  totalInvoicesSettled: number;
  onTimeSettlementRate: number;
  avgDaysLate: number;
  avgDaysEarly: number;
  lastSettledAt: Date | null;
}

export interface ReputationHistoryEntry {
  id: number;
  oldScore: number | null;
  oldTier: string | null;
  newScore: number;
  newTier: string;
  invoiceId: string | null;
  settlementWasOnTime: boolean | null;
  triggerReason: string;
  createdAt: Date;
}

export interface ReputationHistoryQuery {
  limit?: number;
  offset?: number;
}

const TIER_THRESHOLDS = {
  EXCELLENT: 80,
  GOOD: 60,
  FAIR: 40,
  POOR: 0,
};

export class IssuerReputationService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Computes reputation tier from score.
   */
  private computeTier(score: number): ReputationTier {
    if (score >= TIER_THRESHOLDS.EXCELLENT) return "excellent";
    if (score >= TIER_THRESHOLDS.GOOD) return "good";
    if (score >= TIER_THRESHOLDS.FAIR) return "fair";
    return "poor";
  }

  /**
   * Computes reputation score from settlement history components.
   * Score is weighted: 40% on-time rate, 30% total settled, 15% days late, 15% days early.
   */
  private computeScore(
    onTimeRate: number,
    totalSettled: number,
    avgDaysLate: number,
    avgDaysEarly: number
  ): number {
    // On-time settlement rate (0-100) weighted 40%
    const onTimeScore = onTimeRate * 0.4;

    // Total invoices settled (capped at 100) weighted 30%
    const settledScore = Math.min(totalSettled, 100) * 0.3;

    // Days late penalty (capped at 30 days) weighted -15%
    const latePenalty = Math.min(avgDaysLate, 30) * -0.5;

    // Days early bonus (capped at 10 days) weighted +15%
    const earlyBonus = Math.min(avgDaysEarly, 10) * 1.5;

    const rawScore = onTimeScore + settledScore + latePenalty + earlyBonus;
    return Math.max(0, Math.min(100, Math.round(rawScore)));
  }

  /**
   * Gets or creates reputation record for an issuer wallet.
   */
  private async getOrCreateReputation(
    manager: EntityManager,
    walletAddress: string
  ): Promise<IssuerReputation> {
    const repository = manager.getRepository(IssuerReputation);
    let reputation = await repository.findOne({ where: { walletAddress } });

    if (!reputation) {
      reputation = repository.create({
        walletAddress,
        score: 0,
        tier: "poor",
        totalInvoicesSettled: 0,
        onTimeSettlementRate: "0",
        avgDaysLate: "0",
        avgDaysEarly: "0",
        lastSettledAt: null,
      });
      reputation = await repository.save(reputation);
    }

    return reputation;
  }

  /**
   * Computes reputation score from an issuer's settlement history.
   */
  async computeReputation(walletAddress: string): Promise<ReputationScore> {
    const invoiceRepository = this.dataSource.getRepository(Invoice);

    // Get all settled invoices for this issuer
    const invoices = await invoiceRepository
      .createQueryBuilder("invoice")
      .leftJoin("invoice.seller", "seller")
      .where("seller.stellarAddress = :walletAddress", { walletAddress })
      .andWhere("invoice.status = :status", { status: "settled" })
      .select(["invoice.id", "invoice.dueDate", "invoice.createdAt"])
      .getMany();

    if (invoices.length === 0) {
      return {
        score: 0,
        tier: "poor",
        totalInvoicesSettled: 0,
        onTimeSettlementRate: 0,
        avgDaysLate: 0,
        avgDaysEarly: 0,
        lastSettledAt: null,
      };
    }

    // Calculate settlement metrics
    let onTimeCount = 0;
    let totalDaysLate = 0;
    let totalDaysEarly = 0;
    let lastSettledAt: Date | null = null;

    for (const invoice of invoices) {
      const dueDate = new Date(invoice.dueDate);
      const settledDate = invoice.updatedAt; // Using updatedAt as approximation of settlement date
      const daysDiff = Math.floor((settledDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff <= 0) {
        onTimeCount++;
        totalDaysEarly += Math.abs(daysDiff);
      } else {
        totalDaysLate += daysDiff;
      }

      if (!lastSettledAt || settledDate > lastSettledAt) {
        lastSettledAt = settledDate;
      }
    }

    const totalSettled = invoices.length;
    const onTimeRate = (onTimeCount / totalSettled) * 100;
    const avgDaysLate = totalDaysLate / totalSettled;
    const avgDaysEarly = totalDaysEarly / totalSettled;

    const score = this.computeScore(onTimeRate, totalSettled, avgDaysLate, avgDaysEarly);
    const tier = this.computeTier(score);

    return {
      score,
      tier,
      totalInvoicesSettled: totalSettled,
      onTimeSettlementRate: Math.round(onTimeRate * 100) / 100,
      avgDaysLate: Math.round(avgDaysLate * 100) / 100,
      avgDaysEarly: Math.round(avgDaysEarly * 100) / 100,
      lastSettledAt,
    };
  }

  /**
   * Recomputes and updates reputation for an issuer after a settlement event.
   */
  async updateReputationOnSettlement(
    walletAddress: string,
    invoiceId: string,
    wasOnTime: boolean
  ): Promise<ReputationScore> {
    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      const reputation = await this.getOrCreateReputation(manager, walletAddress);
      const newScoreData = await this.computeReputation(walletAddress);

      const oldScore = reputation.score;
      const oldTier = reputation.tier;

      // Update reputation
      reputation.score = newScoreData.score;
      reputation.tier = newScoreData.tier;
      reputation.totalInvoicesSettled = newScoreData.totalInvoicesSettled;
      reputation.onTimeSettlementRate = new Decimal(newScoreData.onTimeSettlementRate).toFixed(2);
      reputation.avgDaysLate = new Decimal(newScoreData.avgDaysLate).toFixed(2);
      reputation.avgDaysEarly = new Decimal(newScoreData.avgDaysEarly).toFixed(2);
      reputation.lastSettledAt = newScoreData.lastSettledAt;

      await manager.save(reputation);

      // Record history if score changed
      if (oldScore !== newScoreData.score || oldTier !== newScoreData.tier) {
        const historyRepository = manager.getRepository(IssuerReputationHistory);
        const history = historyRepository.create({
          issuerReputationId: reputation.id,
          oldScore,
          oldTier,
          newScore: newScoreData.score,
          newTier: newScoreData.tier,
          invoiceId,
          settlementWasOnTime: wasOnTime,
          triggerReason: "settlement",
        });
        await historyRepository.save(history);

        logger.info("issuer_reputation.updated", {
          wallet: walletAddress,
          invoiceId,
          oldScore,
          newScore: newScoreData.score,
          oldTier,
          newTier: newScoreData.tier,
        });
      }

      return newScoreData;
    });

    return result;
  }

  /**
   * Gets reputation for an issuer wallet.
   */
  async getReputation(walletAddress: string): Promise<ReputationScore | null> {
    const repository = this.dataSource.getRepository(IssuerReputation);
    const reputation = await repository.findOne({ where: { walletAddress } });

    if (!reputation) {
      return null;
    }

    return {
      score: reputation.score,
      tier: reputation.tier,
      totalInvoicesSettled: reputation.totalInvoicesSettled,
      onTimeSettlementRate: parseFloat(reputation.onTimeSettlementRate),
      avgDaysLate: parseFloat(reputation.avgDaysLate),
      avgDaysEarly: parseFloat(reputation.avgDaysEarly),
      lastSettledAt: reputation.lastSettledAt,
    };
  }

  /**
   * Gets reputation history for an issuer.
   */
  async getReputationHistory(
    walletAddress: string,
    query: ReputationHistoryQuery = {}
  ): Promise<{ history: ReputationHistoryEntry[]; total: number }> {
    const { limit = 50, offset = 0 } = query;

    const reputationRepository = this.dataSource.getRepository(IssuerReputation);
    const reputation = await reputationRepository.findOne({ where: { walletAddress } });

    if (!reputation) {
      return { history: [], total: 0 };
    }

    const historyRepository = this.dataSource.getRepository(IssuerReputationHistory);
    const [history, total] = await historyRepository.findAndCount({
      where: { issuerReputationId: reputation.id },
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });

    const historyDTOs: ReputationHistoryEntry[] = history.map((h) => ({
      id: h.id,
      oldScore: h.oldScore,
      oldTier: h.oldTier,
      newScore: h.newScore,
      newTier: h.newTier,
      invoiceId: h.invoiceId,
      settlementWasOnTime: h.settlementWasOnTime,
      triggerReason: h.triggerReason,
      createdAt: h.createdAt,
    }));

    return {
      history: historyDTOs,
      total,
    };
  }

  /**
   * Manually recomputes reputation for an issuer (admin operation).
   */
  async recomputeReputation(walletAddress: string): Promise<ReputationScore> {
    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      const reputation = await this.getOrCreateReputation(manager, walletAddress);
      const newScoreData = await this.computeReputation(walletAddress);

      const oldScore = reputation.score;
      const oldTier = reputation.tier;

      // Update reputation
      reputation.score = newScoreData.score;
      reputation.tier = newScoreData.tier;
      reputation.totalInvoicesSettled = newScoreData.totalInvoicesSettled;
      reputation.onTimeSettlementRate = new Decimal(newScoreData.onTimeSettlementRate).toFixed(2);
      reputation.avgDaysLate = new Decimal(newScoreData.avgDaysLate).toFixed(2);
      reputation.avgDaysEarly = new Decimal(newScoreData.avgDaysEarly).toFixed(2);
      reputation.lastSettledAt = newScoreData.lastSettledAt;

      await manager.save(reputation);

      // Record history
      const historyRepository = manager.getRepository(IssuerReputationHistory);
      const history = historyRepository.create({
        issuerReputationId: reputation.id,
        oldScore,
        oldTier,
        newScore: newScoreData.score,
        newTier: newScoreData.tier,
        invoiceId: null,
        settlementWasOnTime: null,
        triggerReason: "manual_recompute",
      });
      await historyRepository.save(history);

      logger.info("issuer_reputation.recomputed", {
        wallet: walletAddress,
        oldScore,
        newScore: newScoreData.score,
        oldTier,
        newTier: newScoreData.tier,
      });

      return newScoreData;
    });

    return result;
  }
}

export function createIssuerReputationService(dataSource: DataSource): IssuerReputationService {
  return new IssuerReputationService(dataSource);
}
