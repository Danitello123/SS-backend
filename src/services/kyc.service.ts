import crypto from "crypto";
import { DataSource, In } from "typeorm";
import { KYCVerification } from "../models/KYCVerification.model";
import { KycHistory } from "../models/KycHistory.model";
import { User } from "../models/User.model";
import { KYCStatus, KYCVerificationType, NotificationType } from "../types/enums";
import { HttpError } from "../utils/http-error";
import { logger, type AppLogger } from "../observability/logger";
import type { NotificationService } from "./notification.service";
import { logKYCStatusChange } from "../lib/kyc-status-log";

export interface KycProviderData {
  verificationType?: KYCVerificationType;
  documents?: Record<string, unknown>;
  providerReference?: string;
}

export interface KycWebhookPayload {
  userId: string;
  status: KYCStatus;
  verificationId?: string;
  providerReference?: string;
  reason?: string;
}

export type KycDocumentType = "passport" | "national_id" | "drivers_license";

export interface KycDocumentSubmission {
  documentType: KycDocumentType;
  documentNumber: string;
  ipfsDocumentUrl: string;
}

export interface KycSubmissionInput {
  sellerDetails?: Record<string, unknown>;
  businessName?: string;
  companyName?: string;
  businessRegistrationNumber?: string;
  registrationNumber?: string;
  taxId?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  documentCids?: string[] | Record<string, string>;
  documentCid?: string;
  cids?: string[];
  ipfsCids?: string[];
  documents?: Record<string, unknown> | string[];
  documentType?: KycDocumentType | string;
  documentNumber?: string;
  ipfsDocumentUrl?: string;
  providerReference?: string;
  verificationType?: KYCVerificationType;
  [key: string]: unknown;
}

export interface KycStatusResponse {
  id?: string;
  status: KYCStatus;
  rejectionReason: string | null;
  wallet?: string | null;
  documents?: Record<string, unknown> | null;
  verifiedAt?: Date | null;
}

export interface KycReviewInput {
  status?: KYCStatus | string;
  action?: string;
  decision?: string;
  reason?: string;
  rejectionReason?: string;
  reviewerId?: string;
  reviewerWallet?: string;
}

/** Statuses that indicate a KYC submission is already in flight or finalized enough to block a new one. */
const PENDING_STATUSES = [KYCStatus.PENDING, KYCStatus.APPROVED];

/** Statuses that allow resubmission (rejected or expired). */
const RESUBMITTABLE_STATUSES = [KYCStatus.REJECTED, KYCStatus.EXPIRED];

export class KycService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly webhookSecret: string,
    private readonly appLogger: AppLogger = logger,
    private readonly notificationService?: NotificationService
  ) {}

  async submitKycVerification(
    userId: string,
    providerData: KycProviderData = {}
  ): Promise<KYCVerification> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOneBy({ id: userId });
      if (!user) throw new HttpError(404, "User not found.");

      const repository = manager.getRepository(KYCVerification);
      const verification = repository.create({
        userId,
        verificationType: providerData.verificationType ?? KYCVerificationType.IDENTITY,
        status: KYCStatus.PENDING,
        documents:
          providerData.documents ??
          (providerData.providerReference
            ? { providerReference: providerData.providerReference }
            : null),
      });
      const saved = await repository.save(verification);
      await manager
        .getRepository(User)
        .update(userId, { kycStatus: KYCStatus.PENDING, isKycVerified: false });
      return saved;
    });
  }

  async submitKycVerificationByWallet(
    wallet: string,
    payload: KycDocumentSubmission
  ): Promise<KYCVerification> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { stellarAddress: wallet },
      });
      if (!user) throw new HttpError(404, "User not found.");

      const repository = manager.getRepository(KYCVerification);
      const existing = await repository.findOne({
        where: {
          wallet,
          status: In(PENDING_STATUSES),
        },
      });
      if (existing) {
        throw new HttpError(
          409,
          "A KYC verification is already pending or approved for this wallet."
        );
      }

      const verification = repository.create({
        userId: user.id,
        wallet,
        verificationType: KYCVerificationType.IDENTITY,
        status: KYCStatus.PENDING,
        documents: {
          documentType: payload.documentType,
          documentNumber: payload.documentNumber,
          ipfsDocumentUrl: payload.ipfsDocumentUrl,
        },
      });
      const saved = await repository.save(verification);

      await manager
        .getRepository(User)
        .update(user.id, { kycStatus: KYCStatus.PENDING, isKycVerified: false });

      this.appLogger.info("kyc.submission.created", {
        user_id: user.id,
        wallet,
        document_type: payload.documentType,
        verification_id: saved.id,
      });

      return saved;
    });
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !this.webhookSecret) return false;
    const supplied = signature.replace(/^sha256=/, "");
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const suppliedBuffer = Buffer.from(supplied, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return (
      suppliedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    );
  }

  async processWebhook(payload: KycWebhookPayload): Promise<void> {
    if (!payload || typeof payload.userId !== "string") {
      throw new HttpError(400, "Webhook userId is required.");
    }
    if (![KYCStatus.APPROVED, KYCStatus.REJECTED].includes(payload.status)) {
      throw new HttpError(400, "Webhook status must be approved or rejected.");
    }

    await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const verificationRepository = manager.getRepository(KYCVerification);
      const historyRepository = manager.getRepository(KycHistory);
      const user = await userRepository.findOneBy({ id: payload.userId });
      if (!user) throw new HttpError(404, "User not found.");

      const verification = payload.verificationId
        ? await verificationRepository.findOneBy({ id: payload.verificationId })
        : await verificationRepository.findOne({
            where: { userId: payload.userId, status: KYCStatus.PENDING },
          });
      if (!verification) throw new HttpError(404, "KYC verification not found.");

      const previousStatus = verification.status;
      verification.status = payload.status;
      verification.verifiedAt = new Date();
      await verificationRepository.save(verification);

      // Archive to history before status change
      const historyEntry = historyRepository.create({
        userId: user.id,
        wallet: verification.wallet,
        verificationType: verification.verificationType,
        status: previousStatus,
        documents: verification.documents,
        rejectionReason: payload.status === KYCStatus.REJECTED ? payload.reason : null,
        providerReference: (verification.documents as { providerReference?: string })?.providerReference || null,
        isArchived: true,
        archivedAt: new Date(),
      });
      await historyRepository.save(historyEntry);

      await userRepository.update(payload.userId, {
        kycStatus: payload.status,
        isKycVerified: payload.status === KYCStatus.APPROVED,
      });
      this.appLogger.info("kyc.webhook.processed", {
        user_id: payload.userId,
        verification_id: verification.id,
        status: payload.status,
        reason: payload.reason ?? null,
      });
    });

    try {
      const notifType =
        payload.status === KYCStatus.APPROVED
          ? NotificationType.KYC_APPROVED
          : NotificationType.KYC_REJECTED;
      const title =
        payload.status === KYCStatus.APPROVED ? "KYC Approved" : "KYC Status Updated";
      const message =
        payload.status === KYCStatus.APPROVED
          ? "Your identity verification has been approved."
          : `Your KYC status has changed to ${payload.status}.`;
      await this.notificationService?.createNotification(
        payload.userId,
        notifType,
        title,
        message,
        { status: payload.status, reason: payload.reason ?? null }
      );
    } catch (error) {
      this.appLogger.warn("kyc.notification.failed", {
        user_id: payload.userId,
        error,
      });
    }
  }

  /**
   * Submit a new KYC verification after rejection or expiry.
   * Previous submission is archived before creating the new one.
   * Only allowed in rejected or expired states.
   */
  async resubmitKycVerification(
    wallet: string,
    payload: KycDocumentSubmission
  ): Promise<KYCVerification> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { stellarAddress: wallet },
      });
      if (!user) throw new HttpError(404, "User not found.");

      const verificationRepository = manager.getRepository(KYCVerification);
      const historyRepository = manager.getRepository(KycHistory);

      // Get current verification
      const currentVerification = await verificationRepository.findOne({
        where: {
          wallet,
          status: In([...PENDING_STATUSES, ...RESUBMITTABLE_STATUSES]),
        },
      });

      if (!currentVerification) {
        throw new HttpError(404, "No existing KYC verification found for this wallet.");
      }

      // Check if resubmission is allowed
      if (!RESUBMITTABLE_STATUSES.includes(currentVerification.status)) {
        throw new HttpError(
          400,
          `Cannot resubmit KYC verification with status ${currentVerification.status}. Only rejected or expired verifications can be resubmitted.`
        );
      }

      // Archive previous submission in history
      const historyEntry = historyRepository.create({
        userId: user.id,
        wallet: currentVerification.wallet,
        verificationType: currentVerification.verificationType,
        status: currentVerification.status,
        documents: currentVerification.documents,
        rejectionReason: currentVerification.status === KYCStatus.REJECTED ? "Resubmitted" : null,
        providerReference: (currentVerification.documents as { providerReference?: string })?.providerReference || null,
        isArchived: true,
        archivedAt: new Date(),
      });
      await historyRepository.save(historyEntry);

      // Create new verification
      const newVerification = verificationRepository.create({
        userId: user.id,
        wallet,
        verificationType: KYCVerificationType.IDENTITY,
        status: KYCStatus.PENDING,
        documents: {
          documentType: payload.documentType,
          documentNumber: payload.documentNumber,
          ipfsDocumentUrl: payload.ipfsDocumentUrl,
        },
      });
      const saved = await verificationRepository.save(newVerification);

      // Update user status
      await manager.getRepository(User).update(user.id, {
        kycStatus: KYCStatus.PENDING,
        isKycVerified: false,
      });

      this.appLogger.info("kyc.resubmission.created", {
        user_id: user.id,
        wallet,
        previous_verification_id: currentVerification.id,
        new_verification_id: saved.id,
        previous_status: currentVerification.status,
      });

      return saved;
    });
  }

  /**
   * Submit KYC details and IPFS document CIDs.
   * If a previous submission was rejected, re-submission resets status to pending and clears rejection reason.
   */
  async submitKyc(
    walletOrUserId: string,
    payload: KycSubmissionInput
  ): Promise<KYCVerification> {
    return this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const verificationRepository = manager.getRepository(KYCVerification);
      const historyRepository = manager.getRepository(KycHistory);

      const user = await userRepository.findOne({
        where: [{ stellarAddress: walletOrUserId }, { id: walletOrUserId }],
      });
      if (!user) {
        throw new HttpError(404, "User not found.");
      }

      const wallet = user.stellarAddress;

      // Extract document CIDs
      let cids: string[] = [];
      if (Array.isArray(payload.documentCids)) {
        cids = payload.documentCids.filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0
        );
      } else if (payload.documentCids && typeof payload.documentCids === "object") {
        cids = Object.values(payload.documentCids).filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0
        );
      } else if (Array.isArray(payload.cids)) {
        cids = payload.cids.filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0
        );
      } else if (Array.isArray(payload.ipfsCids)) {
        cids = payload.ipfsCids.filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0
        );
      } else if (typeof payload.documentCid === "string" && payload.documentCid.trim()) {
        cids = [payload.documentCid.trim()];
      } else if (typeof payload.ipfsDocumentUrl === "string" && payload.ipfsDocumentUrl.trim()) {
        cids = [payload.ipfsDocumentUrl.trim()];
      } else if (Array.isArray(payload.documents)) {
        cids = payload.documents.filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0
        );
      }

      // Extract seller details
      const sellerDetails: Record<string, unknown> = {
        ...(payload.sellerDetails && typeof payload.sellerDetails === "object"
          ? payload.sellerDetails
          : {}),
      };
      if (payload.businessName) sellerDetails.businessName = payload.businessName;
      if (payload.companyName) sellerDetails.companyName = payload.companyName;
      if (payload.businessRegistrationNumber)
        sellerDetails.businessRegistrationNumber = payload.businessRegistrationNumber;
      if (payload.registrationNumber) sellerDetails.registrationNumber = payload.registrationNumber;
      if (payload.taxId) sellerDetails.taxId = payload.taxId;
      if (payload.contactEmail) sellerDetails.contactEmail = payload.contactEmail;
      if (payload.contactPhone) sellerDetails.contactPhone = payload.contactPhone;
      if (payload.address) sellerDetails.address = payload.address;

      // Find existing verification
      const existing = await verificationRepository.findOne({
        where: [
          { wallet, status: In([...PENDING_STATUSES, ...RESUBMITTABLE_STATUSES]) },
          { userId: user.id, status: In([...PENDING_STATUSES, ...RESUBMITTABLE_STATUSES]) },
        ],
        order: { verifiedAt: "DESC" },
      });

      if (existing) {
        if (existing.status === KYCStatus.PENDING) {
          throw new HttpError(409, "A KYC verification is already pending for this wallet.");
        }
        if (existing.status === KYCStatus.APPROVED) {
          throw new HttpError(409, "A KYC verification is already approved for this wallet.");
        }

        // Re-submission allowed on rejected status:
        // Archive existing verification before resetting
        const existingDocs = existing.documents as Record<string, unknown> | null;
        const historyEntry = historyRepository.create({
          userId: user.id,
          wallet: existing.wallet ?? wallet,
          verificationType: existing.verificationType,
          status: existing.status,
          documents: existing.documents,
          rejectionReason:
            (typeof existingDocs?.rejectionReason === "string" ? existingDocs.rejectionReason : null) ??
            (typeof existingDocs?.reason === "string" ? existingDocs.reason : null) ??
            "Resubmitted",
          providerReference:
            typeof existingDocs?.providerReference === "string" ? existingDocs.providerReference : null,
          isArchived: true,
          archivedAt: new Date(),
        });
        await historyRepository.save(historyEntry);

        // Reset verification to PENDING and clear rejection reason
        existing.status = KYCStatus.PENDING;
        existing.verifiedAt = null;
        existing.documents = {
          sellerDetails: Object.keys(sellerDetails).length > 0 ? sellerDetails : null,
          documentCids: cids,
          documentType: payload.documentType ?? "business",
          documentNumber: payload.documentNumber ?? null,
          ipfsDocumentUrl:
            payload.ipfsDocumentUrl ??
            (cids[0]
              ? cids[0].startsWith("ipfs://") || cids[0].startsWith("http")
                ? cids[0]
                : `ipfs://${cids[0]}`
              : null),
          providerReference: payload.providerReference ?? null,
          rejectionReason: null, // Clears rejection reason
          submittedAt: new Date().toISOString(),
        };

        const saved = await verificationRepository.save(existing);

        await userRepository.update(user.id, {
          kycStatus: KYCStatus.PENDING,
          isKycVerified: false,
        });

        this.appLogger.info("kyc.resubmission.created", {
          user_id: user.id,
          wallet,
          verification_id: saved.id,
          status: KYCStatus.PENDING,
        });

        return saved;
      }

      // No existing verification, create new one
      const docData: Record<string, unknown> = {
        sellerDetails: Object.keys(sellerDetails).length > 0 ? sellerDetails : null,
        documentCids: cids,
        documentType: payload.documentType ?? "business",
        documentNumber: payload.documentNumber ?? null,
        ipfsDocumentUrl:
          payload.ipfsDocumentUrl ??
          (cids[0]
            ? cids[0].startsWith("ipfs://") || cids[0].startsWith("http")
              ? cids[0]
              : `ipfs://${cids[0]}`
            : null),
        providerReference: payload.providerReference ?? null,
        rejectionReason: null,
        submittedAt: new Date().toISOString(),
      };

      const verification = verificationRepository.create({
        userId: user.id,
        wallet,
        verificationType: payload.verificationType ?? KYCVerificationType.IDENTITY,
        status: KYCStatus.PENDING,
        documents: docData,
        verifiedAt: null,
      });

      const saved = await verificationRepository.save(verification);

      await userRepository.update(user.id, {
        kycStatus: KYCStatus.PENDING,
        isKycVerified: false,
      });

      this.appLogger.info("kyc.submission.created", {
        user_id: user.id,
        wallet,
        verification_id: saved.id,
        status: KYCStatus.PENDING,
      });

      return saved;
    });
  }

  /**
   * Get current verification status for authenticated wallet/user.
   * Returns current state and rejection reason if applicable.
   */
  async getKycStatus(walletOrUserId: string): Promise<KycStatusResponse> {
    const userRepository = this.dataSource.getRepository(User);
    const verificationRepository = this.dataSource.getRepository(KYCVerification);
    const historyRepository = this.dataSource.getRepository(KycHistory);

    const user = await userRepository.findOne({
      where: [{ stellarAddress: walletOrUserId }, { id: walletOrUserId }],
    });
    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    const verification = await verificationRepository.findOne({
      where: [{ wallet: user.stellarAddress }, { userId: user.id }],
      order: { verifiedAt: "DESC" },
    });

    const status = verification?.status ?? user.kycStatus ?? KYCStatus.PENDING;

    let rejectionReason: string | null = null;
    if (status === KYCStatus.REJECTED) {
      const verDocs = verification?.documents as Record<string, unknown> | null;
      rejectionReason =
        (typeof verDocs?.rejectionReason === "string" ? verDocs.rejectionReason : null) ??
        (typeof verDocs?.reason === "string" ? verDocs.reason : null) ??
        null;

      if (!rejectionReason) {
        const history = await historyRepository.findOne({
          where: [
            { wallet: user.stellarAddress, status: KYCStatus.REJECTED },
            { userId: user.id, status: KYCStatus.REJECTED },
          ],
          order: { createdAt: "DESC" },
        });
        rejectionReason = history?.rejectionReason ?? null;
      }
    }

    return {
      id: verification?.id,
      status,
      rejectionReason,
      wallet: user.stellarAddress,
      documents: verification?.documents ?? null,
      verifiedAt: verification?.verifiedAt ?? null,
    };
  }

  /**
   * Admin review of a KYC verification, transitioning status to approved or rejected with reason.
   */
  async reviewKyc(
    idOrUserId: string,
    input: KycReviewInput
  ): Promise<KYCVerification> {
    const rawAction = (input.status || input.action || input.decision || "").toString().toLowerCase().trim();
    let decision: KYCStatus;
    if (rawAction === "approved" || rawAction === "approve") {
      decision = KYCStatus.APPROVED;
    } else if (rawAction === "rejected" || rawAction === "reject") {
      decision = KYCStatus.REJECTED;
    } else {
      throw new HttpError(400, "Status must be either 'approved' or 'rejected'.");
    }

    const reason = (input.reason || input.rejectionReason || "").toString().trim();
    if (decision === KYCStatus.REJECTED && !reason) {
      throw new HttpError(400, "Rejection reason is required when rejecting KYC verification.");
    }

    return this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const verificationRepository = manager.getRepository(KYCVerification);
      const historyRepository = manager.getRepository(KycHistory);

      // Find verification by id, userId, or wallet
      let verification = await verificationRepository.findOne({
        where: [{ id: idOrUserId }],
      });

      if (!verification) {
        verification = await verificationRepository.findOne({
          where: [{ userId: idOrUserId }, { wallet: idOrUserId }],
          order: { verifiedAt: "DESC" },
        });
      }

      let user: User | null = null;
      if (verification) {
        user = await userRepository.findOne({
          where: [{ id: verification.userId }, { stellarAddress: verification.wallet ?? "" }],
        });
      } else {
        user = await userRepository.findOne({
          where: [{ id: idOrUserId }, { stellarAddress: idOrUserId }],
        });
        if (user) {
          verification = verificationRepository.create({
            userId: user.id,
            wallet: user.stellarAddress,
            verificationType: KYCVerificationType.IDENTITY,
            status: user.kycStatus,
            documents: {},
          });
        }
      }

      if (!verification || !user) {
        throw new HttpError(404, "KYC verification not found.");
      }

      const previousStatus = verification.status;
      const isApproved = decision === KYCStatus.APPROVED;

      verification.status = decision;
      verification.verifiedAt = new Date();

      const docs = { ...(verification.documents || {}) };
      if (isApproved) {
        delete docs.rejectionReason;
        delete docs.reason;
      } else {
        docs.rejectionReason = reason;
      }
      verification.documents = docs;

      const saved = await verificationRepository.save(verification);

      // Archive to history
      const historyEntry = historyRepository.create({
        userId: user.id,
        wallet: verification.wallet ?? user.stellarAddress,
        verificationType: verification.verificationType,
        status: decision,
        documents: docs,
        rejectionReason: isApproved ? null : reason,
        isArchived: true,
        archivedAt: new Date(),
      });
      await historyRepository.save(historyEntry);

      // Update user
      await userRepository.update(user.id, {
        kycStatus: decision,
        isKycVerified: isApproved,
      });

      // Audit log
      logKYCStatusChange(this.appLogger, {
        wallet: user.stellarAddress,
        previousStatus,
        newStatus: decision,
        reviewerWallet: input.reviewerWallet ?? input.reviewerId ?? "admin",
        reviewerId: input.reviewerId,
        action: isApproved ? "approve" : "reject",
        reason: isApproved ? undefined : reason,
      });

      // Notification
      try {
        const notifType = isApproved ? NotificationType.KYC_APPROVED : NotificationType.KYC_REJECTED;
        const notifTitle = isApproved ? "KYC Approved" : "KYC Status Updated";
        const notifMsg = isApproved
          ? "Your identity verification has been approved."
          : `Your KYC verification was rejected: ${reason}`;

        await this.notificationService?.createNotification(
          user.id,
          notifType,
          notifTitle,
          notifMsg,
          { status: decision, reason: isApproved ? null : reason }
        );
      } catch (err) {
        this.appLogger.warn("kyc.notification.failed", { user_id: user.id, error: err });
      }

      return saved;
    });
  }

  /**
   * Get all KYC submission history for a wallet.
   * Returns all records in descending order (newest first).
   */
  async getKycHistory(wallet: string): Promise<KycHistory[]> {
    const historyRepository = this.dataSource.getRepository(KycHistory);
    const history = await historyRepository.find({
      where: { wallet },
      order: { createdAt: "DESC" },
    });

    return history;
  }

  /**
   * Get KYC history for a user by user ID.
   * Returns all records in descending order (newest first).
   */
  async getKycHistoryByUserId(userId: string): Promise<KycHistory[]> {
    const historyRepository = this.dataSource.getRepository(KycHistory);
    const history = await historyRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });

    return history;
  }
}

