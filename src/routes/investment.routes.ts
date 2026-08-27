import { Router, type RequestHandler } from "express";
import { InvestmentController } from "../controllers/investment.controller";
import { InvestmentService } from "../services/investment.service";
import { createAuthMiddleware } from "../middleware/auth.middleware";
import { createWalletRateLimiter } from "../middleware/rate-limit-wallet.middleware";
import { checkContractNotPaused } from "../middleware/contract-pause-guard.middleware";
import type { AuthService } from "../services/auth.service";
import type { ContractGuardService } from "../services/stellar/contract-guard.service";

export interface InvestmentRouterDependencies {
  investmentService: InvestmentService;
  authService: AuthService;
  contractGuardService?: ContractGuardService;
  contractId?: string | null;
}

// Per-wallet rate limit: max 10 investment submissions per 60 seconds
const investmentRateLimiter = createWalletRateLimiter(
  { windowMs: 60_000, maxRequests: 10 },
  "investment-create",
);

export function createInvestmentRouter({
  investmentService,
  authService,
  contractGuardService,
  contractId = null,
}: InvestmentRouterDependencies): Router {
  const router = Router();
  const controller = new InvestmentController(investmentService);
  const authMiddleware = createAuthMiddleware(authService);

  // Only the state-changing endpoint is gated: reading a portfolio during a
  // pause is harmless, and blocking it would hide the state of the system.
  const pauseGuard: RequestHandler[] = contractGuardService
    ? [checkContractNotPaused({ contractGuardService, contractId })]
    : [];

  // POST /api/v1/investments - Create a new investment commitment
  router.post("/", authMiddleware, ...pauseGuard, investmentRateLimiter, controller.createInvestment);

  // GET /api/v1/investments/dashboard - Investor portfolio aggregate
  router.get("/dashboard", authMiddleware, controller.getDashboard);

  // GET /api/v1/investments/analytics - Investor portfolio performance analytics
  router.get("/analytics", authMiddleware, controller.getInvestorAnalytics);

  return router;
}
