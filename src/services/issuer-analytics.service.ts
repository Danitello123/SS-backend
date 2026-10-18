import { DataSource } from "typeorm";
import { Decimal } from "decimal.js";
import { Invoice } from "../models/Invoice.model";
import { Investment } from "../models/Investment.model";
import { User } from "../models/User.model";
import { InvoiceStatus, InvestmentStatus } from "../types/enums";
import { ServiceError } from "../utils/service-error";
import { TtlCache } from "../lib/ttl-cache";

export type AnalyticsRange = "30d" | "90d" | "all";

const VALID_RANGES: readonly AnalyticsRange[] = ["30d", "90d", "all"];

export function isValidAnalyticsRange(value: string): value is AnalyticsRange {
  return (VALID_RANGES as readonly string[]).includes(value);
}

const CAPITAL_RAISED_STATUSES = [InvestmentStatus.CONFIRMED, InvestmentStatus.SETTLED];

export interface InvestorCountPoint {
  /** ISO date (daily) or ISO week/month key, depending on granularity. */
  period: string;
  investorCount: number;
}

export interface IssuerAnalytics {
  issuerId: string;
  range: AnalyticsRange;
  granularity: "day" | "week" | "month";
  totalCapitalRaised: string;
  /** Average calendar days from an invoice's creation to it becoming fully
   * funded; `null` when no invoice in range has been funded yet. */
  avgDaysToFullFunding: number | null;
  /** 0-100; `null` when no invoice in range has settled yet. */
  onTimeRepaymentRate: number | null;
  /** 0-100, currently just the on-time repayment rate (0 when nothing has
   * settled yet -- a new issuer has no track record, not a bad one). */
  reputationScore: number;
  investorCountTrend: InvestorCountPoint[];
  generatedAt: string;
}

const CACHE_TTL_SECONDS = 5 * 60;

function cacheKey(issuerId: string, range: AnalyticsRange): string {
  return `${issuerId}:${range}`;
}

function rangeStart(range: AnalyticsRange, now: Date): Date | null {
  if (range === "all") return null;
  const days = range === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function granularityFor(range: AnalyticsRange): "day" | "week" | "month" {
  if (range === "30d") return "day";
  if (range === "90d") return "week";
  return "month";
}

/** Monday-anchored ISO week key, e.g. "2026-W07". */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodKey(date: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return date.toISOString().slice(0, 7);
  return isoWeekKey(date);
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Issuer analytics (issue #587): funding speed, investor-count trend,
 * on-time repayment rate and a reputation score, aggregated across one
 * issuer's invoices and the investments/settlements against them.
 *
 * `avgDaysToFullFunding` and `onTimeRepaymentRate` are derived from the
 * timestamps already on `Invoice`/`Investment` rather than from a dedicated
 * "funded_at"/"settled_at" column, which this schema doesn't have:
 *
 * - "Became fully funded at" is approximated as the `createdAt` of the last
 *   CONFIRMED/SETTLED investment on an invoice that is FUNDED or SETTLED --
 *   accurate, because `InvestmentService.createInvestment` flips the
 *   invoice to FUNDED in the same transaction as saving the investment that
 *   completed it.
 * - "Settled at" is approximated as the invoice's `updatedAt` while its
 *   `status` is SETTLED. This is the one soft spot: `updatedAt` also moves
 *   on any other field edit to a settled invoice (there is currently none in
 *   this codebase, but nothing enforces that). A dedicated `settledAt`
 *   column would remove the ambiguity; out of scope here.
 */
export class IssuerAnalyticsService {
  private readonly cache = new TtlCache({
    ttlSeconds: CACHE_TTL_SECONDS,
    namespace: "issuer-analytics",
    enabled: true,
  });

  constructor(private readonly dataSource: DataSource) {}

  /** Resolves `wallet` (a Stellar address) to the issuer's internal id, then delegates to `getAnalytics`. */
  async getAnalyticsByWallet(
    wallet: string,
    range: AnalyticsRange,
    now: Date = new Date(),
  ): Promise<IssuerAnalytics> {
    const issuer = await this.dataSource.getRepository(User).findOneBy({ stellarAddress: wallet });
    if (!issuer) {
      throw new ServiceError("ISSUER_NOT_FOUND", "No issuer found for that wallet", 404);
    }
    return this.getAnalytics(issuer.id, range, now);
  }

  async getAnalytics(
    issuerId: string,
    range: AnalyticsRange,
    now: Date = new Date(),
  ): Promise<IssuerAnalytics> {
    if (!issuerId) {
      throw new ServiceError("MISSING_ISSUER", "issuer wallet/id is required");
    }

    const key = cacheKey(issuerId, range);
    const cached = await this.cache.get<IssuerAnalytics>(key);
    if (cached) return cached;

    const value = await this.computeAnalytics(issuerId, range, now);
    await this.cache.set(key, value);
    return value;
  }

  /** Call after any settlement or invoice state change for this issuer, so
   * the next read recomputes rather than serving a stale cached figure. */
  invalidate(issuerId: string): void {
    this.cache.invalidatePrefix(`${issuerId}:`);
  }

  private async computeAnalytics(
    issuerId: string,
    range: AnalyticsRange,
    now: Date,
  ): Promise<IssuerAnalytics> {
    const invoiceRepo = this.dataSource.getRepository(Invoice);
    const investmentRepo = this.dataSource.getRepository(Investment);

    const start = rangeStart(range, now);
    const granularity = granularityFor(range);

    const invoices = start
      ? await invoiceRepo
          .createQueryBuilder("invoice")
          .where("invoice.seller_id = :issuerId", { issuerId })
          .andWhere("invoice.created_at >= :start", { start })
          .getMany()
      : await invoiceRepo.find({ where: { sellerId: issuerId } });

    if (invoices.length === 0) {
      return {
        issuerId,
        range,
        granularity,
        totalCapitalRaised: "0.0000",
        avgDaysToFullFunding: null,
        onTimeRepaymentRate: null,
        reputationScore: 0,
        investorCountTrend: [],
        generatedAt: now.toISOString(),
      };
    }

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    const investments = await investmentRepo
      .createQueryBuilder("investment")
      .where("investment.invoice_id IN (:...invoiceIds)", { invoiceIds })
      .getMany();

    // ---- total capital raised ----
    let totalCapitalRaised = new Decimal(0);
    for (const investment of investments) {
      if (CAPITAL_RAISED_STATUSES.includes(investment.status)) {
        totalCapitalRaised = totalCapitalRaised.plus(new Decimal(investment.investmentAmount));
      }
    }

    // ---- avg days to full funding ----
    const fundingDurations: number[] = [];
    for (const invoice of invoices) {
      if (invoice.status !== InvoiceStatus.FUNDED && invoice.status !== InvoiceStatus.SETTLED) {
        continue;
      }
      const backing = investments.filter(
        (investment) =>
          investment.invoiceId === invoice.id &&
          CAPITAL_RAISED_STATUSES.includes(investment.status),
      );
      if (backing.length === 0) continue;

      const fundedAt = backing.reduce(
        (latest, investment) => (investment.createdAt > latest ? investment.createdAt : latest),
        backing[0]!.createdAt,
      );
      fundingDurations.push(daysBetween(invoice.createdAt, fundedAt));
    }
    const avgDaysToFullFunding =
      fundingDurations.length > 0
        ? Number(
            (fundingDurations.reduce((sum, d) => sum + d, 0) / fundingDurations.length).toFixed(2),
          )
        : null;

    // ---- on-time repayment rate ----
    const settledInvoices = invoices.filter((invoice) => invoice.status === InvoiceStatus.SETTLED);
    let onTimeRepaymentRate: number | null = null;
    if (settledInvoices.length > 0) {
      const onTime = settledInvoices.filter((invoice) => {
        const dueDate = new Date(invoice.dueDate);
        return invoice.updatedAt.getTime() <= dueDate.getTime() + 24 * 60 * 60 * 1000 - 1;
      }).length;
      onTimeRepaymentRate = Number(((onTime / settledInvoices.length) * 100).toFixed(2));
    }

    const reputationScore = onTimeRepaymentRate ?? 0;

    // ---- investor count trend ----
    const investorsByPeriod = new Map<string, Set<string>>();
    for (const investment of investments) {
      if (!invoiceById.has(investment.invoiceId)) continue; // defensive; invoiceIds is exact
      const key = periodKey(investment.createdAt, granularity);
      const set = investorsByPeriod.get(key) ?? new Set<string>();
      set.add(investment.investorId);
      investorsByPeriod.set(key, set);
    }
    const investorCountTrend = Array.from(investorsByPeriod.entries())
      .map(([period, investorIds]) => ({ period, investorCount: investorIds.size }))
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

    return {
      issuerId,
      range,
      granularity,
      totalCapitalRaised: totalCapitalRaised.toFixed(4),
      avgDaysToFullFunding,
      onTimeRepaymentRate,
      reputationScore,
      investorCountTrend,
      generatedAt: now.toISOString(),
    };
  }
}

export function createIssuerAnalyticsService(dataSource: DataSource): IssuerAnalyticsService {
  return new IssuerAnalyticsService(dataSource);
}
