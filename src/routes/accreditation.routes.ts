import { Router, type Response, type NextFunction } from "express";
import { createAuthMiddleware, requireInvestor, requireAdmin } from "../middleware/auth.middleware";
import type { AuthService } from "../services/auth.service";
import type { InvestorAccreditationService } from "../services/investor-accreditation.service";
import type { AuthenticatedRequest } from "../types/auth";
import { HttpError } from "../utils/http-error";
import { AccreditationTier } from "../models/InvestorAccreditation.model";

export interface AccreditationRouterDependencies {
  authService: AuthService;
  accreditationService: InvestorAccreditationService;
}

export function createAccreditationRouter({
  authService,
  accreditationService,
}: AccreditationRouterDependencies): Router {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.get(
    "/:wallet",
    auth,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { wallet } = req.params;
        const accreditation = await accreditationService.getAccreditation(wallet);

        res.json({
          walletAddress: accreditation.walletAddress,
          tier: accreditation.tier,
          verificationDate: accreditation.verificationDate,
          investmentLimit: accreditationService.getInvestmentLimit(accreditation.tier as AccreditationTier),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/:wallet",
    auth,
    requireAdmin(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { wallet } = req.params;
        const { tier, verificationSource } = req.body;

        if (!Object.values(AccreditationTier).includes(tier)) {
          throw new HttpError("Invalid tier", 400);
        }

        const accreditation = await accreditationService.updateAccreditation(
          wallet,
          tier as AccreditationTier,
          verificationSource
        );

        res.json({
          walletAddress: accreditation.walletAddress,
          tier: accreditation.tier,
          verificationDate: accreditation.verificationDate,
          investmentLimit: accreditationService.getInvestmentLimit(accreditation.tier as AccreditationTier),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/:wallet/eligibility/:invoiceId",
    auth,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { wallet, invoiceId } = req.params;
        const eligibility = await accreditationService.checkEligibility(
          wallet,
          invoiceId
        );

        res.json(eligibility);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
