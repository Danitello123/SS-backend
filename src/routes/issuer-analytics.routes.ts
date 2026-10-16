import { Router } from "express";
import { IssuerAnalyticsController } from "../controllers/issuer-analytics.controller";
import type { IssuerAnalyticsService } from "../services/issuer-analytics.service";
import { authenticateJWT } from "../middleware/auth.middleware";

export interface IssuerAnalyticsRouterDependencies {
  issuerAnalyticsService: IssuerAnalyticsService;
}

export function createIssuerAnalyticsRouter({
  issuerAnalyticsService,
}: IssuerAnalyticsRouterDependencies): Router {
  const router = Router();
  const controller = new IssuerAnalyticsController(issuerAnalyticsService);

  // GET /api/v1/issuers/:wallet/analytics?range=30d|90d|all
  router.get("/:wallet/analytics", authenticateJWT, controller.getAnalytics);

  return router;
}
