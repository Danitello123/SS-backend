import { Router, type Response, type NextFunction } from "express";
import { createAuthMiddleware, requireInvestor } from "../../middleware/auth.middleware";
import type { AuthService } from "../../services/auth.service";
import type { InvoiceRefundService } from "../../services/invoice-refund.service";
import type { AuthenticatedRequest } from "../../types/auth";
import { HttpError } from "../../utils/http-error";
import { ServiceError } from "../../utils/service-error";
import { logger } from "../../observability/logger";

export interface RefundRouterDependencies {
  authService: AuthService;
  refundService: InvoiceRefundService;
}

export function createRefundRouter({
  authService,
  refundService,
}: RefundRouterDependencies): Router {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.post(
    "/:invoiceId/refund",
    auth,
    requireInvestor(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { invoiceId } = req.params;
        const wallet = req.user?.wallet;

        if (!wallet) {
          throw new HttpError("Wallet not found in request", 401);
        }

        const { canRefund, reason } = await refundService.canRefund(invoiceId);
        if (!canRefund) {
          throw new HttpError(reason || "Cannot refund invoice", 400);
        }

        await refundService.refundInvestment(invoiceId, wallet);

        logger.info("Refund processed", { invoiceId, wallet });

        res.status(200).json({
          message: "Refund processed successfully",
          invoiceId,
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          return next(new HttpError(error.message, error.statusCode));
        }
        next(error);
      }
    }
  );

  router.get(
    "/refundable",
    auth,
    requireInvestor(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const wallet = req.user?.wallet;

        if (!wallet) {
          throw new HttpError("Wallet not found in request", 401);
        }

        const refundableInvoices = await refundService.getRefundableInvoices(wallet);

        res.json({
          invoices: refundableInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            amount: inv.amount,
            fundingDeadline: inv.fundingDeadline,
          })),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
