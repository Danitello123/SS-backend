import { Request, Response, NextFunction } from "express";
import { IssuerReputationService } from "../services/issuer-reputation.service";
import { AppError } from "../utils/http-error";
import { logger } from "../observability/logger";

export class IssuerReputationController {
  constructor(private readonly issuerReputationService: IssuerReputationService) {}

  /**
   * GET /issuers/:wallet/reputation - Returns reputation score, breakdown, and history.
   */
  async getReputation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wallet } = req.params;

      if (!wallet || typeof wallet !== "string") {
        throw new AppError(400, "Wallet address is required", "INVALID_WALLET");
      }

      const reputation = await this.issuerReputationService.getReputation(wallet);

      if (!reputation) {
        res.status(200).json({
          success: true,
          data: {
            wallet,
            hasHistory: false,
            reputation: null,
          },
        });
        return;
      }

      const historyQuery = {
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 10,
        offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
      };

      const historyResult = await this.issuerReputationService.getReputationHistory(wallet, historyQuery);

      res.status(200).json({
        success: true,
        data: {
          wallet,
          hasHistory: true,
          reputation,
          history: historyResult.history,
          meta: {
            totalHistory: historyResult.total,
            limit: historyQuery.limit,
            offset: historyQuery.offset,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /issuers/:wallet/reputation/recompute - Manually recomputes reputation (admin only).
   */
  async recomputeReputation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wallet } = req.params;

      if (!wallet || typeof wallet !== "string") {
        throw new AppError(400, "Wallet address is required", "INVALID_WALLET");
      }

      const reputation = await this.issuerReputationService.recomputeReputation(wallet);

      logger.info("admin.issuer_reputation_recomputed", { wallet });

      res.status(200).json({
        success: true,
        data: {
          wallet,
          reputation,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export function createIssuerReputationController(
  issuerReputationService: IssuerReputationService
): IssuerReputationController {
  return new IssuerReputationController(issuerReputationService);
}
