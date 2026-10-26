import express, { Router, type Request, type Response, type NextFunction } from "express";
import Joi from "joi";
import { KycService } from "../services/kyc.service";
import { createKycController } from "../controllers/kyc.controller";
import { createAuthMiddleware, requireSeller } from "../middleware/auth.middleware";
import { HttpError } from "../utils/http-error";
import type { AuthService } from "../services/auth.service";
import { UserType } from "../types/enums";
import type { AuthenticatedRequest } from "../types/auth";

const KYC_DOCUMENT_TYPES = [
  "passport",
  "national_id",
  "drivers_license",
  "business",
  "identity",
  "address",
] as const;

const submitKycSchema = Joi.object({
  documentType: Joi.string()
    .valid(...KYC_DOCUMENT_TYPES)
    .required()
    .trim()
    .messages({
      "any.only": "documentType must be one of: passport, national_id, drivers_license, business, identity, address",
      "any.required": "documentType is required",
      "string.empty": "documentType is required",
    }),
  documentNumber: Joi.string()
    .trim()
    .required()
    .max(255)
    .messages({
      "any.required": "documentNumber is required",
      "string.empty": "documentNumber is required",
    }),
  ipfsDocumentUrl: Joi.string()
    .trim()
    .uri()
    .required()
    .messages({
      "any.required": "ipfsDocumentUrl is required",
      "string.empty": "ipfsDocumentUrl is required",
      "string.uri": "ipfsDocumentUrl must be a valid URL",
    }),
});

const submitKycFlexibleSchema = Joi.object({
  sellerDetails: Joi.object().optional(),
  businessName: Joi.string().trim().max(255).optional(),
  companyName: Joi.string().trim().max(255).optional(),
  businessRegistrationNumber: Joi.string().trim().max(255).optional(),
  registrationNumber: Joi.string().trim().max(255).optional(),
  taxId: Joi.string().trim().max(255).optional(),
  contactEmail: Joi.string().email().optional(),
  contactPhone: Joi.string().trim().max(50).optional(),
  address: Joi.string().trim().max(500).optional(),
  documentCids: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().required()).min(1),
      Joi.object().pattern(Joi.string(), Joi.string().trim().required())
    )
    .optional(),
  documentCid: Joi.string().trim().optional(),
  cids: Joi.array().items(Joi.string().trim().required()).optional(),
  ipfsCids: Joi.array().items(Joi.string().trim().required()).optional(),
  ipfsDocumentUrl: Joi.string().trim().optional(),
  documents: Joi.alternatives()
    .try(
      Joi.object(),
      Joi.array().items(Joi.string().trim().required())
    )
    .optional(),
  documentType: Joi.string().valid(...KYC_DOCUMENT_TYPES).optional(),
  documentNumber: Joi.string().trim().max(255).optional(),
  verificationType: Joi.string().optional(),
  providerReference: Joi.string().optional(),
})
  .unknown(true)
  .or(
    "documentCids",
    "documentCid",
    "cids",
    "ipfsCids",
    "ipfsDocumentUrl",
    "documents",
    "documentNumber",
    "providerReference"
  )
  .messages({
    "object.missing": "At least one IPFS document CID or URL is required for KYC submission.",
  });

function validateKycBody(req: Request, _res: Response, next: NextFunction): void {
  const { error, value } = submitKycSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    next(
      new HttpError(
        422,
        "Invalid KYC submission.",
        error.details.map((detail) => detail.message)
      )
    );
    return;
  }

  req.body = value;
  next();
}

function validateSubmitKycBody(req: Request, _res: Response, next: NextFunction): void {
  const { error, value } = submitKycFlexibleSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    next(
      new HttpError(
        422,
        "Invalid KYC submission.",
        error.details.map((detail) => detail.message)
      )
    );
    return;
  }

  req.body = value;
  next();
}

function createAdminAuthMiddleware(authService?: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey && adminKey === process.env.ADMIN_API_KEY) {
      return next();
    }

    if (!authService) {
      return next(new HttpError(401, "Admin authentication required."));
    }

    const auth = createAuthMiddleware(authService);
    auth(req as AuthenticatedRequest, res, (err?: unknown) => {
      if (err) return next(err);
      const user = (req as AuthenticatedRequest).user;
      const userRecord = user as unknown as Record<string, unknown> | undefined;
      if (
        user &&
        (user.userType === UserType.ADMIN ||
          userRecord?.isAdmin === true ||
          userRecord?.role === "admin")
      ) {
        return next();
      }
      return next(new HttpError(403, "Admin privileges required"));
    });
  };
}

export function createKycWebhookRouter(service: KycService): Router {
  const router = Router();
  const controller = createKycController(service);
  router.post(
    "/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    controller.webhook
  );
  return router;
}

export function createKycRouter(service: KycService, authService: AuthService): Router {
  const router = Router();
  const controller = createKycController(service);
  const adminAuth = createAdminAuthMiddleware(authService);

  // POST /kyc - legacy route for seller identity documents
  router.post(
    "/",
    createAuthMiddleware(authService),
    requireSeller(),
    validateKycBody,
    controller.submitDocument
  );

  // POST /kyc/submit - accepts seller details and IPFS document CIDs
  router.post(
    "/submit",
    createAuthMiddleware(authService),
    validateSubmitKycBody,
    controller.submit
  );

  // GET /kyc/status - returns current verification status for authenticated wallet
  router.get(
    "/status",
    createAuthMiddleware(authService),
    controller.getStatus
  );

  // GET /kyc - alias for /status
  router.get(
    "/",
    createAuthMiddleware(authService),
    controller.getStatus
  );

  // Admin PATCH /kyc/:id/review - updates status to approved or rejected with reason
  router.patch(
    "/:id/review",
    adminAuth,
    controller.review
  );

  router.patch(
    "/review/:id",
    adminAuth,
    controller.review
  );

  // POST /kyc/resubmit - resubmission allowed on rejected status
  router.post(
    "/resubmit",
    createAuthMiddleware(authService),
    validateSubmitKycBody,
    controller.resubmit
  );

  // GET /kyc/history - history records
  router.get(
    "/history",
    createAuthMiddleware(authService),
    controller.getHistory
  );

  return router;
}

