import { Router, Request, Response, NextFunction } from "express";
import { SecondaryMarketController } from "../controllers/secondary-market.controller";
import { SecondaryMarketService } from "../services/secondary-market.service";
import { createAuthMiddleware } from "../middleware/auth.middleware";
import type { AuthService } from "../services/auth.service";
import type { AuthenticatedRequest } from "../types/auth";

export interface SecondaryMarketRouterDependencies {
  secondaryMarketService: SecondaryMarketService;
  authService: AuthService;
}

export function createSecondaryMarketRouter({
  secondaryMarketService,
  authService,
}: SecondaryMarketRouterDependencies): Router {
  const router = Router();
  const controller = new SecondaryMarketController(secondaryMarketService);
  const authMiddleware = createAuthMiddleware(authService);

  const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers && req.headers.authorization) {
      return authMiddleware(req as AuthenticatedRequest, res, next);
    }
    next();
  };

  // POST /secondary-market/listings - Create a new listing
  router.post("/listings", authMiddleware, controller.createListing);

  // GET /secondary-market/listings - Get active listings with filters
  router.get("/listings", optionalAuth, controller.getListings);

  // GET /secondary-market/listings/:id - Get listing details
  router.get("/listings/:id", optionalAuth, controller.getListingById);

  // POST /secondary-market/listings/:id/buy - Buy a listing
  router.post("/listings/:id/buy", authMiddleware, controller.buyListing);

  // DELETE /secondary-market/listings/:id - Cancel a listing
  router.delete("/listings/:id", authMiddleware, controller.cancelListing);

  // POST /secondary-market/listings/:id/cancel - Cancel a listing (POST alias)
  router.post("/listings/:id/cancel", authMiddleware, controller.cancelListing);

  return router;
}
