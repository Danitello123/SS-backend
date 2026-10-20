import { DataSource } from "typeorm";
import { TtlCache } from "../lib/ttl-cache";

export interface InsurancePolicy {
  invoiceId: string;
  wallet: string;
  isActive: boolean;
  coverageBps: number;
  premiumPaid: string;
  expiry: number;
  purchasedAt: number;
}

export interface InsurancePayout {
  invoiceId: string;
  wallet: string;
  amount: string;
  triggerDate: number;
  txHash: string;
}

export interface InvoiceInsuranceResponse {
  isActive: boolean;
  coverageBps: number;
  premiumPaid: string;
  expiry: number;
}

/**
 * #680 — Invoice insurance indexer and policy status REST API.
 * Indexes InsurancePurchased and InsurancePayoutTriggered events.
 */
export class InvoiceInsuranceService {
  private cache: TtlCache;

  constructor(private readonly dataSource: DataSource) {
    this.cache = new TtlCache({ ttlSeconds: 60, namespace: "insurance" });
  }

  async getInvoiceInsurance(invoiceId: string, wallet: string): Promise<InvoiceInsuranceResponse | null> {
    const cacheKey = `invoice:${invoiceId}:${wallet}`;
    const cached = this.cache.get<InvoiceInsuranceResponse>(cacheKey);
    if (cached) return cached;

    const row = await this.dataSource.query(
      `SELECT is_active, coverage_bps, premium_paid, expiry
       FROM invoice_insurance WHERE invoice_id = $1 AND wallet = $2`,
      [invoiceId, wallet],
    );

    if (!row.length) return null;

    const result = {
      isActive: row[0].is_active,
      coverageBps: row[0].coverage_bps,
      premiumPaid: row[0].premium_paid,
      expiry: row[0].expiry,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  async getWalletActivePolicies(wallet: string): Promise<InsurancePolicy[]> {
    const cacheKey = `wallet:${wallet}`;
    const cached = this.cache.get<InsurancePolicy[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT invoice_id, wallet, is_active, coverage_bps, premium_paid, expiry, purchased_at
       FROM invoice_insurance WHERE wallet = $1 AND is_active = true`,
      [wallet],
    );

    const policies = rows.map((r: any) => ({
      invoiceId: r.invoice_id,
      wallet: r.wallet,
      isActive: r.is_active,
      coverageBps: r.coverage_bps,
      premiumPaid: r.premium_paid,
      expiry: r.expiry,
      purchasedAt: r.purchased_at,
    }));

    this.cache.set(cacheKey, policies);
    return policies;
  }

  async getWalletPayoutHistory(wallet: string): Promise<InsurancePayout[]> {
    const cacheKey = `payouts:${wallet}`;
    const cached = this.cache.get<InsurancePayout[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT invoice_id, wallet, amount, trigger_date, tx_hash
       FROM insurance_payouts WHERE wallet = $1 ORDER BY trigger_date DESC`,
      [wallet],
    );

    const payouts = rows.map((r: any) => ({
      invoiceId: r.invoice_id,
      wallet: r.wallet,
      amount: r.amount,
      triggerDate: r.trigger_date,
      txHash: r.tx_hash,
    }));

    this.cache.set(cacheKey, payouts);
    return payouts;
  }

  /** Invalidate cache for a wallet/invoice pair when an insurance event occurs. */
  invalidate(invoiceId: string, wallet: string): void {
    this.cache.delete(`invoice:${invoiceId}:${wallet}`);
    this.cache.delete(`wallet:${wallet}`);
    this.cache.delete(`payouts:${wallet}`);
  }
}
