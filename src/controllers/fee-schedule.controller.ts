import { Request, Response, NextFunction } from "express";
import { FeeScheduleService, UpdateFeeScheduleInput } from "../services/fee-schedule.service";
import { AppError } from "../utils/http-error";
import { logger } from "../observability/logger";
import type { AuthenticatedRequest } from "../types/auth";

export class FeeScheduleController {
  constructor(private readonly feeScheduleService: FeeScheduleService) {}

  /**
   * GET /admin/fees - Returns current fee schedule with all rates.
   */
  async getCurrentFeeSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schedule = await this.feeScheduleService.getCurrentFeeSchedule();
      res.status(200).json({
        success: true,
        data: schedule,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /admin/fees - Updates fee rates, admin only, validates rate bounds.
   */
  async updateFeeSchedule(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body || {};
      const actorWallet = req.user?.stellarAddress || "admin";
      const actorRole = req.user?.role || "admin";

      const input: UpdateFeeScheduleInput = {
        investmentFeeBps: body.investmentFeeBps,
        settlementFeeBps: body.settlementFeeBps,
        platformFeeBps: body.platformFeeBps,
        secondaryMarketFeeBps: body.secondaryMarketFeeBps,
        changeReason: body.changeReason,
      };

      const updatedSchedule = await this.feeScheduleService.updateFeeSchedule(input, actorWallet, actorRole);

      logger.info("admin.fee_schedule_updated", {
        actor: actorWallet,
        input,
      });

      res.status(200).json({
        success: true,
        data: updatedSchedule,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/fees/history - Returns paginated change log with actor, old and new values, timestamp.
   */
  async getFeeScheduleHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

      if (isNaN(limit) || limit < 1 || limit > 100) {
        throw new AppError(400, "Limit must be between 1 and 100", "INVALID_LIMIT");
      }

      if (isNaN(offset) || offset < 0) {
        throw new AppError(400, "Offset must be a non-negative integer", "INVALID_OFFSET");
      }

      const result = await this.feeScheduleService.getFeeScheduleHistory({ limit, offset });

      res.status(200).json({
        success: true,
        data: result.history,
        meta: {
          total: result.total,
          limit,
          offset,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export function createFeeScheduleController(feeScheduleService: FeeScheduleService): FeeScheduleController {
  return new FeeScheduleController(feeScheduleService);
}
