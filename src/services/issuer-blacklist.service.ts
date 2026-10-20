import { DataSource } from "typeorm";
import { TtlCache } from "../lib/ttl-cache";

export interface BlacklistStatus {
  isBlacklisted: boolean;
  reason: string | null;
  blacklistedAt: number | null;
}

export interface BlacklistedIssuer {
  wallet: string;
  reason: string;
  blacklistedAt: number;
}

export interface BlacklistPage {
  issuers: BlacklistedIssuer[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * #685 — Issuer blacklist indexer and status REST API.
 * Indexes IssuerBlacklisted and IssuerRestored events.
 */
export class IssuerBlacklistService {
  private cache: TtlCache;

  constructor(private readonly dataSource: DataSource) {
    this.cache = new TtlCache({ ttlSeconds: 60, namespace: "issuer-blacklist" });
  }

  async getBlacklistStatus(wallet: string): Promise<BlacklistStatus> {
    const cacheKey = `status:${wallet}`;
    const cached = this.cache.get<BlacklistStatus>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT is_blacklisted, reason, blacklisted_at
       FROM issuer_blacklist WHERE wallet = $1`,
      [wallet],
    );

    let status: BlacklistStatus;
    if (rows.length && rows[0].is_blacklisted) {
      status = {
        isBlacklisted: true,
        reason: rows[0].reason,
        blacklistedAt: rows[0].blacklisted_at,
      };
    } else {
      status = { isBlacklisted: false, reason: null, blacklistedAt: null };
    }

    this.cache.set(cacheKey, status);
    return status;
  }

  async getBlacklistedIssuers(page: number = 1, pageSize: number = 20): Promise<BlacklistPage> {
    const cacheKey = `list:${page}:${pageSize}`;
    const cached = this.cache.get<BlacklistPage>(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * pageSize;
    const [rows, countResult] = await Promise.all([
      this.dataSource.query(
        `SELECT wallet, reason, blacklisted_at
         FROM issuer_blacklist WHERE is_blacklisted = true
         ORDER BY blacklisted_at DESC LIMIT $1 OFFSET $2`,
        [pageSize, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) as total FROM issuer_blacklist WHERE is_blacklisted = true`,
      ),
    ]);

    const result: BlacklistPage = {
      issuers: rows.map((r: any) => ({
        wallet: r.wallet,
        reason: r.reason,
        blacklistedAt: r.blacklisted_at,
      })),
      total: parseInt(countResult[0].total, 10),
      page,
      pageSize,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /** Invalidate cache for a wallet when a blacklist event occurs. */
  invalidate(wallet: string): void {
    this.cache.delete(`status:${wallet}`);
    // Clear list cache entries
    this.cache.clearNamespace("issuer-blacklist");
  }
}
