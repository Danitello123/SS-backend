import { Router, type Response, type NextFunction } from "express";
import { createAuthMiddleware } from "../../middleware/auth.middleware";
import type { AuthService } from "../../services/auth.service";
import type { SecondaryMarketPriceService, PriceRange } from "../../services/secondary-market-price.service";
import type { AuthenticatedRequest } from "../../types/auth";
import { HttpError } from "../../utils/http-error";

export interface PriceHistoryRouterDependencies {
  authService: AuthService;
  priceService: SecondaryMarketPriceService;
}

export function createPriceHistoryRouter({
  authService,
  priceService,
}: PriceHistoryRouterDependencies): Router {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.get(
    "/invoices/:invoiceId/price-history",
    auth,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const invoiceId = Array.isArray(req.params.invoiceId)
          ? req.params.invoiceId[0]
          : req.params.invoiceId;
        const rangeParam = req.query.range;
        const range =
          typeof rangeParam === "string" ? (rangeParam as PriceRange) : "30d";
        if (!invoiceId) {
          throw new HttpError(400, "Invoice ID is required");
        }

        if (!["7d", "30d", "all"].includes(range)) {
          throw new HttpError(400, "Invalid range parameter");
        }

        const { history, currentAvg } = await priceService.getPriceHistory(
          invoiceId,
          range
        );

        res.json({
          invoiceId,
          range,
          history: history.map((p) => ({
            timestamp: p.timestamp,
            minPrice: p.minPrice.toString(),
            maxPrice: p.maxPrice.toString(),
            avgPrice: p.avgPrice.toString(),
          })),
          currentAveragePrice: currentAvg.toString(),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
