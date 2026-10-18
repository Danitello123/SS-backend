import { DataSource } from "typeorm";
import { InvoiceDraft } from "../models/InvoiceDraft.model";
import { ServiceError } from "../utils/service-error";
import { logger } from "../observability/logger";
import { randomUUID } from "crypto";

const DRAFT_EXPIRY_DAYS = 30;

export interface DraftData {
  invoiceNumber?: string;
  customerName?: string;
  issuerName?: string;
  description?: string;
  amount?: string;
  discountRate?: string;
  dueDate?: string;
  ipfsHash?: string;
  title?: string;
  faceValue?: string;
  fundingTarget?: string;
  yieldBps?: number;
  fundingDeadline?: string;
  [key: string]: unknown;
}

export interface DraftListItem {
  id: string;
  lastSavedAt: Date;
  expiresAt: Date;
}

export class InvoiceDraftService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Generates a new draft ID.
   */
  private generateDraftId(): string {
    return `draft_${randomUUID()}`;
  }

  /**
   * Calculates expiry date for a draft.
   */
  private calculateExpiryDate(): Date {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + DRAFT_EXPIRY_DAYS);
    return expiry;
  }

  /**
   * Upserts a draft with full form field state.
   */
  async saveDraft(
    sellerId: string,
    sellerWallet: string,
    draftId: string | null,
    draftData: DraftData
  ): Promise<InvoiceDraft> {
    const repository = this.dataSource.getRepository(InvoiceDraft);

    // Clean up expired drafts for this seller
    await this.cleanupExpiredDrafts(sellerId);

    const id = draftId || this.generateDraftId();
    const expiresAt = this.calculateExpiryDate();

    // Check if draft exists
    const existingDraft = await repository.findOne({ where: { id } });

    if (existingDraft) {
      // Verify ownership
      if (existingDraft.sellerId !== sellerId) {
        throw new ServiceError("FORBIDDEN", "Cannot modify another seller's draft", 403);
      }

      // Update existing draft
      existingDraft.draftData = draftData;
      existingDraft.lastSavedAt = new Date();
      existingDraft.expiresAt = expiresAt;
      const saved = await repository.save(existingDraft);

      logger.info("invoice_draft.updated", {
        draftId: id,
        sellerId,
        sellerWallet,
      });

      return saved;
    } else {
      // Create new draft
      const draft = repository.create({
        id,
        sellerId,
        sellerWallet,
        draftData,
        lastSavedAt: new Date(),
        expiresAt,
      });
      const saved = await repository.save(draft);

      logger.info("invoice_draft.created", {
        draftId: id,
        sellerId,
        sellerWallet,
      });

      return saved;
    }
  }

  /**
   * Lists all resumable drafts for a seller.
   */
  async listDrafts(sellerId: string): Promise<DraftListItem[]> {
    const repository = this.dataSource.getRepository(InvoiceDraft);

    // Clean up expired drafts first
    await this.cleanupExpiredDrafts(sellerId);

    const drafts = await repository.find({
      where: { sellerId },
      order: { lastSavedAt: "DESC" },
    });

    return drafts.map((draft) => ({
      id: draft.id,
      lastSavedAt: draft.lastSavedAt,
      expiresAt: draft.expiresAt,
    }));
  }

  /**
   * Returns full draft field data for resume.
   */
  async getDraft(draftId: string, sellerId: string): Promise<DraftData> {
    const repository = this.dataSource.getRepository(InvoiceDraft);

    const draft = await repository.findOne({ where: { id: draftId } });

    if (!draft) {
      throw new ServiceError("DRAFT_NOT_FOUND", "Draft not found", 404);
    }

    // Verify ownership
    if (draft.sellerId !== sellerId) {
      throw new ServiceError("FORBIDDEN", "Cannot access another seller's draft", 403);
    }

    // Check if expired
    if (new Date() > draft.expiresAt) {
      await repository.remove(draft);
      throw new ServiceError("DRAFT_EXPIRED", "Draft has expired", 410);
    }

    return draft.draftData as DraftData;
  }

  /**
   * Discards a draft.
   */
  async deleteDraft(draftId: string, sellerId: string): Promise<void> {
    const repository = this.dataSource.getRepository(InvoiceDraft);

    const draft = await repository.findOne({ where: { id: draftId } });

    if (!draft) {
      throw new ServiceError("DRAFT_NOT_FOUND", "Draft not found", 404);
    }

    // Verify ownership
    if (draft.sellerId !== sellerId) {
      throw new ServiceError("FORBIDDEN", "Cannot delete another seller's draft", 403);
    }

    await repository.remove(draft);

    logger.info("invoice_draft.deleted", {
      draftId,
      sellerId,
    });
  }

  /**
   * Cleans up expired drafts for a seller.
   */
  private async cleanupExpiredDrafts(sellerId: string): Promise<void> {
    const repository = this.dataSource.getRepository(InvoiceDraft);

    const now = new Date();
    const expiredDrafts = await repository
      .createQueryBuilder("draft")
      .where("draft.sellerId = :sellerId", { sellerId })
      .andWhere("draft.expiresAt < :now", { now })
      .getMany();

    if (expiredDrafts.length > 0) {
      await repository.remove(expiredDrafts);
      logger.info("invoice_draft.cleanup", {
        sellerId,
        count: expiredDrafts.length,
      });
    }
  }

  /**
   * Cleans up all expired drafts (scheduled job).
   */
  async cleanupAllExpiredDrafts(): Promise<number> {
    const repository = this.dataSource.getRepository(InvoiceDraft);

    const now = new Date();
    const expiredDrafts = await repository
      .createQueryBuilder("draft")
      .where("draft.expiresAt < :now", { now })
      .getMany();

    if (expiredDrafts.length > 0) {
      await repository.remove(expiredDrafts);
      logger.info("invoice_draft.bulk_cleanup", {
        count: expiredDrafts.length,
      });
    }

    return expiredDrafts.length;
  }
}

export function createInvoiceDraftService(dataSource: DataSource): InvoiceDraftService {
  return new InvoiceDraftService(dataSource);
}
