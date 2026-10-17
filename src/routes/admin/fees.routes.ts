import { Router } from "express";
import { createFeeScheduleController } from "@/controllers/fee-schedule.controller";
import type { FeeScheduleService } from "@/services/fee-schedule.service";

export function createAdminFeesRouter(feeScheduleService: FeeScheduleService): Router {
  const router = Router();
  const controller = createFeeScheduleController(feeScheduleService);

  // GET /admin/fees - current fee schedule with all rates
  router.get("/fees", (req, res, next) => {
    controller.getCurrentFeeSchedule(req, res, next);
  });

  // PUT /admin/fees - update fee rates, admin only, validates rate bounds
  router.put("/fees", (req, res, next) => {
    controller.updateFeeSchedule(req, res, next);
  });

  // GET /admin/fees/history - paginated change log with actor, old and new values, timestamp
  router.get("/fees/history", (req, res, next) => {
    controller.getFeeScheduleHistory(req, res, next);
  });

  return router;
}
