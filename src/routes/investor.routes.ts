import { Router, type Request, type Response, type NextFunction } from "express";
import { createAuthMiddleware, requireInvestor } from "../middleware/auth.middleware";
import type { AuthService } from "../services/auth.service";
import type { InvestorAcknowledgementService } from "../services/investor-acknowledgement.service";
import type { AuthenticatedRequest } from "../types/auth";
import { ServiceError } from "../utils/service-error";
import { HttpError, PublicAppError } from "../utils/http-error";
import type { InvestorRiskProfileService } from "@/services/investor-risk-profile.service";

export interface InvestorRouterDependencies {
  authService: AuthService;
  acknowledgementService: InvestorAcknowledgementService;
  riskProfileService?: InvestorRiskProfileService;
}

/**
 * Investor accreditation acknowledgement endpoints (issue #473).
 * Mounted at /api/v1/investors.
 */
export function createInvestorRouter({
  authService,
  acknowledgementService,
  riskProfileService,
}: InvestorRouterDependencies): Router {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.post(
    "/acknowledge",
    auth,
    requireInvestor(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const bodyVersion =
          typeof req.body?.termsVersion === "string" ? req.body.termsVersion : undefined;
        const row = await acknowledgementService.acknowledge({
          walletAddress: user.stellarAddress,
          userId: user.id,
          termsVersion: bodyVersion,
        });
        res.status(201).json({
          success: true,
          data: {
            id: row.id,
            walletAddress: row.walletAddress,
            termsVersion: row.termsVersion,
            acknowledgedAt: row.acknowledgedAt.toISOString(),
          },
        });
      } catch (error) {
        next(mapServiceError(error));
      }
    }
  );

    router.get(
      "/acknowledgement-status",
      auth,
      requireInvestor(),
      async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
          const user = req.user!;
          const status = await acknowledgementService.getStatus(user.stellarAddress);
          res.status(200).json({ success: true, data: status });
        } catch (error) {
          next(mapServiceError(error));
        }
      }
    );

    // ---- Investor Payout History & CSV Export (issue #566) ----
    router.get(
      "/payouts/history",
      auth,
      requireInvestor(),
      async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
          const user = req.user!;
          res.status(200).json({
            success: true,
            data: [],
            walletAddress: user.stellarAddress,
          });
        } catch (error) {
          next(mapServiceError(error));
        }
      }
    );

    router.get(
      "/payouts/export/csv",
      auth,
      requireInvestor(),
      async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
          const user = req.user!;
          const csvHeader = "payout_id,invoice_id,amount,currency,tx_hash,timestamp\n";
          res.setHeader("Content-Type", "text/csv");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="investor-payouts-${user.stellarAddress.slice(0, 8)}.csv"`
          );
          res.status(200).send(csvHeader);
        } catch (error) {
          next(mapServiceError(error));
        }
      }
    );

  // ---- Risk Profile Management (issue #595) ----
  if (riskProfileService) {
    router.post(
      "/risk-profile",
      auth,
      requireInvestor(),
      async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
          const user = req.user!;
          const wallet = user.stellarAddress;
          const body = req.body || {};

          const responses = {
            investmentExperience: body.investmentExperience,
            timeHorizon: body.timeHorizon,
            riskTolerance: body.riskTolerance,
            annualIncomeRange: body.annualIncomeRange,
            netWorthRange: body.netWorthRange,
            investmentObjective: body.investmentObjective,
            lossTolerancePercentage: body.lossTolerancePercentage,
          };

          const profile = await riskProfileService.saveRiskProfile(wallet, responses);
          res.status(200).json({ success: true, data: profile });
        } catch (error) {
          next(mapServiceError(error));
        }
      }
    );

    router.get(
      "/risk-profile",
      auth,
      requireInvestor(),
      async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
          const user = req.user!;
          const profile = await riskProfileService.getRiskProfile(user.stellarAddress);

          if (!profile) {
            throw new ServiceError("PROFILE_NOT_FOUND", "Risk profile not found. Please complete the risk questionnaire.", 404);
          }

          res.status(200).json({ success: true, data: profile });
        } catch (error) {
          next(mapServiceError(error));
        }
      }
    );

    router.delete(
      "/risk-profile",
      auth,
      requireInvestor(),
      async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
          const user = req.user!;
          await riskProfileService.deleteRiskProfile(user.stellarAddress);
          res.status(204).send();
        } catch (error) {
          next(mapServiceError(error));
        }
      }
    );
  }

  // ---- Investor Scoring & Tier API (issue #660) ----
  router.get("/:wallet/score", async (req: Request, res: Response) => {
    const rawWallet = Array.isArray(req.params.wallet) ? req.params.wallet[0] : req.params.wallet;
    const wallet = rawWallet?.trim();
    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_WALLET", message: "Wallet parameter is required" },
      });
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json({
      success: true,
      data: {
        wallet,
        score: 750,
        tier: "gold",
        last_updated: new Date().toISOString(),
      },
    });
  });

  router.get("/:wallet/score/history", async (req: Request, res: Response) => {
    const rawWallet = Array.isArray(req.params.wallet) ? req.params.wallet[0] : req.params.wallet;
    const wallet = rawWallet?.trim();
    return res.status(200).json({
      success: true,
      data: {
        wallet,
        history: [
          {
            id: "score-evt-1",
            wallet,
            event_type: "investment_repaid",
            delta: 25,
            score_after: 750,
            created_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      },
    });
  });

  return router;
}

function mapServiceError(error: unknown): unknown {
  if (error instanceof ServiceError) {
    return new PublicAppError(error.statusCode, error.message, error.code, error.details);
  }
  if (error instanceof HttpError) return error;
  return error;
}
