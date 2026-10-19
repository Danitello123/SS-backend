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

interface RefundInvoiceParamsRequest extends AuthenticatedRequest {
  params: { invoiceId: string };
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
    async (req: RefundInvoiceParamsRequest, res: Response, next: NextFunction) => {
      try {
        const { invoiceId } = req.params;
        const wallet = req.user?.stellarAddress;

        if (!wallet) {
          throw new HttpError(401, "Wallet not found in request");
        }

        const { canRefund, reason } = await refundService.canRefund(invoiceId);
        if (!canRefund) {
          throw new HttpError(400, reason || "Cannot refund invoice");
        }

        await refundService.refundInvestment(invoiceId, wallet);

        logger.info("Refund processed", { invoiceId, wallet });

        res.status(200).json({
          message: "Refund processed successfully",
          invoiceId,
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          return next(new HttpError(error.statusCode, error.message));
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
        const wallet = req.user?.stellarAddress;

        if (!wallet) {
          throw new HttpError(401, "Wallet not found in request");
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
