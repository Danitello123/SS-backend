import { Repository, Between, LessThan, IsNull } from "typeorm";
import { SecondaryMarketPriceHistory, PriceHistoryPoint } from "../models/SecondaryMarketPriceHistory.model";
import { SecondaryListing } from "../models/SecondaryListing.model";
import { ListingStatus } from "../types/enums";
import Decimal from "decimal.js";
import { logger } from "../observability/logger";

export type PriceRange = "7d" | "30d" | "all";

const RANGE_DAYS: Record<PriceRange, number> = {
  "7d": 7,
  "30d": 30,
  all: 90,
};

export class SecondaryMarketPriceService {
  constructor(
    private priceHistoryRepo: Repository<SecondaryMarketPriceHistory>,
    private listingRepo: Repository<SecondaryListing>
  ) {}

  async recordPrice(
    invoiceId: string,
    askPrice: Decimal
  ): Promise<SecondaryMarketPriceHistory> {
    const priceHistory = this.priceHistoryRepo.create({
      invoiceId,
      askPrice,
    });

    return this.priceHistoryRepo.save(priceHistory);
  }

  async getPriceHistory(
    invoiceId: string,
    range: PriceRange = "30d"
  ): Promise<{ history: PriceHistoryPoint[]; currentAvg: Decimal }> {
    const days = RANGE_DAYS[range];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const prices = await this.priceHistoryRepo.find({
      where: {
        invoiceId,
        createdAt: Between(startDate, new Date()),
      },
      order: { createdAt: "ASC" },
    });

    const history = this.aggregatePrices(prices);
    const currentListings = await this.listingRepo.find({
      where: { invoiceId, status: ListingStatus.ACTIVE, deletedAt: IsNull() },
    });

    let currentAvg = new Decimal(0);
    if (currentListings.length > 0) {
      const sum = currentListings.reduce(
        (acc, listing) => acc.plus(listing.pricePerFraction),
        new Decimal(0)
      );
      currentAvg = sum.dividedBy(currentListings.length);
    }

    return { history, currentAvg };
  }

  private aggregatePrices(
    prices: SecondaryMarketPriceHistory[]
  ): PriceHistoryPoint[] {
    if (prices.length === 0) return [];

    const grouped = new Map<string, Decimal[]>();

    prices.forEach((p) => {
      const day = p.createdAt.toISOString().split("T")[0];
      if (!grouped.has(day)) {
        grouped.set(day, []);
      }
      grouped.get(day)!.push(p.askPrice);
    });

    const points: PriceHistoryPoint[] = [];

    for (const [day, prices] of grouped.entries()) {
      const sorted = prices.sort((a, b) => a.cmp(b));
      const minPrice = sorted[0];
      const maxPrice = sorted[sorted.length - 1];
      const avgPrice = prices.reduce((a, b) => a.plus(b), new Decimal(0)).dividedBy(prices.length);

      points.push({
        timestamp: new Date(day),
        minPrice,
        maxPrice,
        avgPrice,
      });
    }

    return points;
  }

  async prunePriceHistory(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const result = await this.priceHistoryRepo.delete({
      createdAt: LessThan(cutoffDate),
    });

    logger.info("Pruned price history", {
      deletedCount: result.affected,
    });
  }
}
