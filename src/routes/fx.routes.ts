import { Router, Request, Response } from "express";
import type { AllFxRatesResponse, FxRateRecord } from "../types/market";

/**
 * FX rate and currency conversion routes (issue #663).
 * Mounted at /api/v1/fx and /fx.
 */
export function createFxRouter(): Router {
  const router = Router();

  // In-memory / cached fallback rate table for currency conversion
  const ratesTable: Record<string, { rate: string; updatedAt: number }> = {
    "XLM/USD": { rate: "0.1250", updatedAt: Date.now() },
    "USDC/USD": { rate: "1.0000", updatedAt: Date.now() },
    "EUR/USD": { rate: "1.0850", updatedAt: Date.now() },
    "GBP/USD": { rate: "1.2700", updatedAt: Date.now() },
  };

  // GET /fx/rates - returns all current rates
  router.get("/rates", (_req: Request, res: Response) => {
    const now = Date.now();
    const rates: FxRateRecord[] = Object.entries(ratesTable).map(([pair, item]) => {
      const ageSeconds = Math.floor((now - item.updatedAt) / 1000);
      return {
        pair,
        rate: item.rate,
        updated_at: new Date(item.updatedAt).toISOString(),
        age_seconds: ageSeconds,
        stale: ageSeconds > 3600,
      };
    });

    const response: AllFxRatesResponse = {
      rates,
      timestamp: new Date(now).toISOString(),
    };

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: response });
  });

  // GET /fx/rates/:pair - returns single pair rate with staleness
  router.get("/rates/:pair", (req: Request, res: Response) => {
    const rawPair = Array.isArray(req.params.pair) ? req.params.pair[0] : req.params.pair;
    const pair = decodeURIComponent(rawPair || "").toUpperCase();
    const item = ratesTable[pair];

    if (!item) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PAIR_NOT_FOUND",
          message: `Currency pair '${pair}' not supported`,
        },
      });
    }

    const now = Date.now();
    const ageSeconds = Math.floor((now - item.updatedAt) / 1000);

    const record: FxRateRecord = {
      pair,
      rate: item.rate,
      updated_at: new Date(item.updatedAt).toISOString(),
      age_seconds: ageSeconds,
      stale: ageSeconds > 3600,
    };

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: record });
  });

  return router;
}
