import { Router } from "express";
import { DataSource } from "typeorm";

import { ipWhitelistMiddleware } from "@/middleware/ip-whitelist.middleware";
import type { InvoiceService } from "@/services/invoice.service";
import type { InvestorInsightsService } from "@/services/investor-insights.service";
import { approveKYC } from "./approve-kyc";
import { rejectKYC } from "./reject-kyc";
import { revokeKYC } from "./revoke-kyc";

export interface AdminRouterDependencies {
  dataSource: DataSource;
  allowedCidrs: string[];
  /** Optional: enables POST /invoices/:id/reject. Omitted deployments
   *  (e.g. minimal test apps) simply won't mount that route. */
  invoiceService?: InvoiceService;
  investorInsightsService?: InvestorInsightsService;
}

export function createAdminRouter({
  dataSource,
  allowedCidrs,
  invoiceService: _invoiceService,
  investorInsightsService,
}: AdminRouterDependencies): Router {
  const router = Router();
  const ipWhitelist = ipWhitelistMiddleware(allowedCidrs);

  router.use(ipWhitelist);

  router.post("/approve-kyc", (req, res) => {
    approveKYC(req, res, dataSource);
  });

  router.post("/reject-kyc", (req, res) => {
    rejectKYC(req, res, dataSource);
  });

  router.post("/revoke-kyc", (req, res) => {
    revokeKYC(req, res, dataSource);
  });

  if (investorInsightsService) {
    router.get("/onboarding-bonus/pool-balance", async (_req, res, next) => {
      try {
        const balance = await investorInsightsService.getBonusPoolBalance();
        res.status(200).json({ success: true, data: { pool_balance: balance } });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}