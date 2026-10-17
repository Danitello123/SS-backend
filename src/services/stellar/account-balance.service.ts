import { Decimal } from "decimal.js";
import { ServiceError } from "../../utils/service-error";

interface HorizonBalanceEntry {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

interface HorizonAccountResponse {
  balances: HorizonBalanceEntry[];
}

export interface AccountBalanceChecker {
  /** The account's balance of `assetCode` (or native XLM when omitted). */
  getBalance(stellarAddress: string, assetCode?: string): Promise<Decimal>;
}

/**
 * Reads an account's balance straight from Horizon (issue #596's "balance
 * check before execution"). No caching: a balance that's a few seconds
 * stale is exactly the gap auto-invest execution could double-spend
 * through.
 */
export class HorizonAccountBalanceService implements AccountBalanceChecker {
  constructor(
    private readonly horizonUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async getBalance(stellarAddress: string, assetCode?: string): Promise<Decimal> {
    const url = `${this.horizonUrl.replace(/\/+$/, "")}/accounts/${stellarAddress}`;

    let response: Response;
    try {
      response = await this.fetchImplementation(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new ServiceError("horizon_unreachable", `Could not reach Horizon: ${message}`, 502);
    }

    if (response.status === 404) {
      // An unfunded account genuinely has a zero balance -- not an error.
      return new Decimal(0);
    }
    if (!response.ok) {
      throw new ServiceError(
        "horizon_account_fetch_failed",
        `Horizon returned ${response.status} for account ${stellarAddress}`,
        502,
      );
    }

    const account = (await response.json()) as HorizonAccountResponse;
    const entry = account.balances.find((balance) =>
      assetCode ? balance.asset_code === assetCode : balance.asset_type === "native",
    );

    return entry ? new Decimal(entry.balance) : new Decimal(0);
  }
}
