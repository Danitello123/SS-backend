import { Router } from "express";
import { createIssuerReputationController } from "@/controllers/issuer-reputation.controller";
import type { IssuerReputationService } from "@/services/issuer-reputation.service";
import { createAuthMiddleware } from "@/middleware/auth.middleware";
import { requireAdmin } from "@/middleware/auth.middleware";
import type { AuthService } from "@/services/auth.service";

export function createIssuerReputationRouter({
  issuerReputationService,
  authService,
  adminWallets = [],
}: {
  issuerReputationService: IssuerReputationService;
  authService: AuthService;
  adminWallets?: string[];
}): Router {
  const router = Router();
  const controller = createIssuerReputationController(issuerReputationService);

  // GET /issuers/:wallet/reputation - public read
  router.get("/issuers/:wallet/reputation", (req, res, next) => {
    controller.getReputation(req, res, next);
  });

  // POST /issuers/:wallet/reputation/recompute - admin only
  const authenticateJWT = createAuthMiddleware(authService);
  const requireAdminJWT = requireAdmin(adminWallets);

  router.post(
    "/issuers/:wallet/reputation/recompute",
    authenticateJWT,
    requireAdminJWT,
    (req, res, next) => {
      controller.recomputeReputation(req, res, next);
    }
  );

  return router;
}
