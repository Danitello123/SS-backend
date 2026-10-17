import { Router, type Response, type NextFunction } from "express";
import { createAuthMiddleware, requireAdmin } from "../middleware/auth.middleware";
import type { AuthService } from "../services/auth.service";
import type { InvestorAccreditationService } from "../services/investor-accreditation.service";
import type { AuthenticatedRequest } from "../types/auth";
import { HttpError } from "../utils/http-error";
import { AccreditationTier } from "../models/InvestorAccreditation.model";

export interface AccreditationRouterDependencies {
  authService: AuthService;
  accreditationService: InvestorAccreditationService;
  adminWallets?: string[];
}

interface WalletParamsRequest extends AuthenticatedRequest {
  params: { wallet: string };
}

interface WalletEligibilityParamsRequest extends AuthenticatedRequest {
  params: { wallet: string; invoiceId: string };
}

export function createAccreditationRouter({
  authService,
  accreditationService,
  adminWallets = [],
}: AccreditationRouterDependencies): Router {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.get(
    "/:wallet",
    auth,
    async (req: WalletParamsRequest, res: Response, next: NextFunction) => {
      try {
        const wallet = String(req.params.wallet);
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
    requireAdmin(adminWallets),
    async (req: WalletParamsRequest, res: Response, next: NextFunction) => {
      try {
        const wallet = String(req.params.wallet);
        const { tier, verificationSource } = req.body;

        if (!Object.values(AccreditationTier).includes(tier)) {
          throw new HttpError(400, "Invalid tier");
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
    async (req: WalletEligibilityParamsRequest, res: Response, next: NextFunction) => {
      try {
        const wallet = String(req.params.wallet);
        const invoiceId = String(req.params.invoiceId);
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
