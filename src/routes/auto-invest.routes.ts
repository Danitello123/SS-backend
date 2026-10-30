import { Router } from "express";
import { AutoInvestController } from "../controllers/auto-invest.controller";
import type { AutoInvestRulesService } from "../services/auto-invest-rules.service";
import { createAuthMiddleware } from "../middleware/auth.middleware";
import type { AuthService } from "../services/auth.service";

export interface AutoInvestRouterDependencies {
  autoInvestRulesService: AutoInvestRulesService;
  authService: AuthService;
}

export function createAutoInvestRouter({
  autoInvestRulesService,
  authService,
}: AutoInvestRouterDependencies): Router {
  const router = Router();
  const controller = new AutoInvestController(autoInvestRulesService);
  const authMiddleware = createAuthMiddleware(authService);

  // POST /api/v1/auto-invest/rules - create a rule
  router.post("/rules", authMiddleware, controller.createRule);

  // GET /api/v1/auto-invest/rules - list my rules
  router.get("/rules", authMiddleware, controller.listRules);

  // DELETE /api/v1/auto-invest/rules/:ruleId - remove a rule
  router.delete("/rules/:ruleId", authMiddleware, controller.deleteRule);

  return router;
}
