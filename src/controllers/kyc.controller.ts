import { Request, Response, NextFunction } from "express";
import { KycService } from "../services/kyc.service";
import { AuthenticatedRequest } from "../types/auth";

function getErrorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.statusCode === "number") return candidate.statusCode;
    if (typeof candidate.status === "number") return candidate.status;
  }
  return 500;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    return (error as Record<string, unknown>).message as string;
  }
  return fallback;
}

export function createKycController(service: KycService) {
  return {
    submit: async (req: AuthenticatedRequest, res: Response, next?: NextFunction) => {
      try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        const walletOrId = req.user.stellarAddress || req.user.id;
        const verification = await service.submitKyc(walletOrId, req.body);
        return res.status(201).json({
          success: true,
          status: verification.status,
          data: verification,
        });
      } catch (error) {
        if (next) return next(error);
        const status = getErrorStatus(error);
        return res.status(status).json({
          success: false,
          error: getErrorMessage(error, "Submission failed"),
        });
      }
    },

    getStatus: async (req: AuthenticatedRequest, res: Response, next?: NextFunction) => {
      try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        const walletOrId = req.user.stellarAddress || req.user.id;
        const statusResult = await service.getKycStatus(walletOrId);
        return res.status(200).json({
          success: true,
          status: statusResult.status,
          rejectionReason: statusResult.rejectionReason,
          data: statusResult,
        });
      } catch (error) {
        if (next) return next(error);
        const status = getErrorStatus(error);
        return res.status(status).json({
          success: false,
          error: getErrorMessage(error, "Status check failed"),
        });
      }
    },

    review: async (req: Request | AuthenticatedRequest, res: Response, next?: NextFunction) => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          return res.status(400).json({
            error: { code: "ID_REQUIRED", message: "Verification id is required" },
          });
        }

        const authUser = (req as AuthenticatedRequest).user;
        const reviewerId = authUser?.id || (req.headers["x-reviewer-id"] as string) || "admin";
        const reviewerWallet = authUser?.stellarAddress || "admin";

        const verification = await service.reviewKyc(id, {
          ...req.body,
          reviewerId,
          reviewerWallet,
        });

        const docs = verification.documents as Record<string, unknown> | null;
        const rejectionReason =
          typeof docs?.rejectionReason === "string" ? docs.rejectionReason : null;

        return res.status(200).json({
          success: true,
          status: verification.status,
          rejectionReason,
          data: verification,
        });
      } catch (error) {
        if (next) return next(error);
        const status = getErrorStatus(error);
        return res.status(status).json({
          success: false,
          error: getErrorMessage(error, "Review failed"),
        });
      }
    },

    submitDocument: async (req: AuthenticatedRequest, res: Response, next?: NextFunction) => {
      try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        const verification = await service.submitKycVerificationByWallet(
          req.user.stellarAddress,
          req.body
        );
        return res.status(201).json({ success: true, data: verification });
      } catch (error) {
        if (next) return next(error);
        const status = getErrorStatus(error);
        return res.status(status).json({
          success: false,
          error: getErrorMessage(error, "Submission failed"),
        });
      }
    },

    webhook: async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body)) {
        return res
          .status(400)
          .json({ error: { code: "RAW_BODY_REQUIRED", message: "Raw webhook body required" } });
      }
      const rawBody = req.body;
      if (!service.verifyWebhookSignature(rawBody, req.header("x-provider-signature"))) {
        return res.status(401).json({
          error: { code: "INVALID_WEBHOOK_SIGNATURE", message: "Invalid webhook signature" },
        });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res
          .status(400)
          .json({ error: { code: "INVALID_WEBHOOK_PAYLOAD", message: "Invalid JSON payload" } });
      }
      await service.processWebhook(payload as Parameters<KycService["processWebhook"]>[0]);
      return res.status(204).send();
    },

    resubmit: async (req: AuthenticatedRequest, res: Response, next?: NextFunction) => {
      try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        const walletOrId = req.user.stellarAddress || req.user.id;
        const verification = await service.submitKyc(walletOrId, req.body);
        return res.status(201).json({
          success: true,
          status: verification.status,
          data: verification,
        });
      } catch (error) {
        if (next) return next(error);
        const status = getErrorStatus(error);
        return res.status(status).json({
          success: false,
          error: getErrorMessage(error, "Resubmission failed"),
        });
      }
    },

    getHistory: async (req: AuthenticatedRequest, res: Response, next?: NextFunction) => {
      try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        const history = await service.getKycHistory(req.user.stellarAddress);
        return res.status(200).json({ success: true, data: history });
      } catch (error) {
        if (next) return next(error);
        const status = getErrorStatus(error);
        return res.status(status).json({
          success: false,
          error: getErrorMessage(error, "History fetch failed"),
        });
      }
    },
  };
}
