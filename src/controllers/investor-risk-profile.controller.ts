import { Request, Response, NextFunction } from "express";
import { InvestorRiskProfileService, RiskProfileInput } from "../services/investor-risk-profile.service";
import { AppError } from "../utils/http-error";
import type { AuthenticatedRequest } from "../types/auth";

export class InvestorRiskProfileController {
  constructor(private readonly riskProfileService: InvestorRiskProfileService) {}

  /**
   * POST /investors/:wallet/risk-profile - Stores questionnaire responses and computes tier.
   */
  async saveRiskProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wallet } = req.params;
      const walletAddress = Array.isArray(wallet) ? wallet[0] : wallet;
      const body = req.body || {};

      // Ensure wallet matches authenticated user
      if (req.user?.stellarAddress && req.user.stellarAddress !== walletAddress) {
        throw new AppError(403, "Cannot create risk profile for another wallet", "FORBIDDEN");
      }

      const responses: RiskProfileInput = {
        investmentExperience: body.investmentExperience,
        timeHorizon: body.timeHorizon,
        riskTolerance: body.riskTolerance,
        annualIncomeRange: body.annualIncomeRange,
        netWorthRange: body.netWorthRange,
        investmentObjective: body.investmentObjective,
        lossTolerancePercentage: body.lossTolerancePercentage,
      };

      const profile = await this.riskProfileService.saveRiskProfile(walletAddress, responses);

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /investors/:wallet/risk-profile - Returns tier, responses, and last updated.
   */
  async getRiskProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wallet } = req.params;
      const walletAddress = Array.isArray(wallet) ? wallet[0] : wallet;

      const profile = await this.riskProfileService.getRiskProfile(walletAddress);

      if (!profile) {
        throw new AppError(
          404,
          "Risk profile not found. Please complete the risk questionnaire.",
          "PROFILE_REQUIRED"
        );
      }

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /investors/:wallet/risk-profile - Deletes risk profile.
   */
  async deleteRiskProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wallet } = req.params;
      const walletAddress = Array.isArray(wallet) ? wallet[0] : wallet;

      // Ensure wallet matches authenticated user
      if (req.user?.stellarAddress && req.user.stellarAddress !== walletAddress) {
        throw new AppError(403, "Cannot delete risk profile for another wallet", "FORBIDDEN");
      }

      await this.riskProfileService.deleteRiskProfile(walletAddress);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export function createInvestorRiskProfileController(
  riskProfileService: InvestorRiskProfileService
): InvestorRiskProfileController {
  return new InvestorRiskProfileController(riskProfileService);
}
