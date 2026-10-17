import { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { submitInvoiceSchema } from "@/lib/invoice-submission.schema";
import { adminNotificationQueue } from "@/services/admin-notification-queue.service";
import { UserType } from "@/types/enums";
import type { AuthenticatedRequest } from "@/types/auth";
import type { InvoiceService } from "@/services/invoice.service";
import { ServiceError } from "@/utils/service-error";

export async function submitInvoice(
  req: Request | AuthenticatedRequest,
  res: Response,
  invoiceService?: InvoiceService
) {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Must be a seller (not an investor)
    if (user.userType && user.userType === UserType.INVESTOR) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Only sellers can submit invoices for review",
        },
      });
    }

    const parseResult = submitInvoiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((e: z.ZodIssue) => ({
        field: e.path.join(".") || "unknown",
        message: e.message,
        code: e.code,
      }));
      return res.status(422).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: fieldErrors,
        },
        errors: fieldErrors,
      });
    }

    const {
      title,
      description,
      faceValue,
      fundingTarget,
      yieldBps,
      fundingDeadline,
      ipfsDocumentUrl,
    } = parseResult.data;

    const sellerWallet = user.stellarAddress;
    const sellerId = user.id;
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    if (!invoiceService) {
      throw new ServiceError("invoice_service_unavailable", "Invoice service is unavailable", 500);
    }

    // Creates the invoice as a draft, then drives it through the same
    // InvoiceStateMachine transition (draft -> pending) that admin-review
    // submissions use, so status history and notification side effects fire
    // exactly once, instead of writing the entity straight to the repository.
    const created = await invoiceService.createInvoice({
      sellerId,
      invoiceNumber,
      customerName: title,
      description,
      amount: faceValue.toString(),
      discountRate: (yieldBps / 100).toFixed(2),
      dueDate: fundingDeadline,
      ipfsHash: ipfsDocumentUrl,
      sellerWallet,
      title,
      faceValue: faceValue.toString(),
      fundingTarget: fundingTarget.toString(),
      yieldBps,
      fundingDeadline,
      ipfsDocumentUrl,
    });

    const submitted = await invoiceService.submitInvoiceForReview({
      invoiceId: created.id,
      sellerId,
    });

    // Emit invoice_submitted event to admin notification queue
    await adminNotificationQueue.emitEvent("invoice_submitted", {
      invoiceId: submitted.id,
      sellerId,
      sellerWallet,
      title,
      description,
      faceValue,
      fundingTarget,
      yieldBps,
      fundingDeadline,
      ipfsDocumentUrl,
      submittedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      data: submitted,
    });
  } catch (err: unknown) {
    const appErr = err as { status?: number; statusCode?: number; code?: string; message?: string };
    return res.status(appErr.statusCode ?? appErr.status ?? 500).json({
      error: {
        code: appErr.code ?? "INTERNAL_ERROR",
        message: appErr.message ?? "Internal server error",
      },
    });
  }
}
