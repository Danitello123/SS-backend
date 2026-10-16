import { DataSource } from "typeorm";
import { Invoice } from "../models/Invoice.model";
import { User } from "../models/User.model";
import { InvoiceDocument } from "../models/InvoiceDocument.model";
import { InvoiceStatus, KYCStatus } from "../types/enums";
import { ServiceError } from "../utils/service-error";
import { validateInvoiceForPublish } from "../lib/validate-invoice-for-publish";
import type { IPFSService, IPFSUploadResult } from "./ipfs.service";

export interface InvoiceRepositoryContract {
  findOne(options: { where: { id: string }; relations?: string[] }): Promise<Invoice | null>;
  findOneBy(options: { id?: string; invoiceNumber?: string }): Promise<Invoice | null>;
  find(options: {
    where: { sellerId: string; status?: InvoiceStatus };
    skip?: number;
    take?: number;
    order?: { [key: string]: "ASC" | "DESC" };
  }): Promise<Invoice[]>;
  save(invoice: Invoice): Promise<Invoice>;
  count(options: { where: { sellerId: string; status?: InvoiceStatus } }): Promise<number>;
  create(data: Partial<Invoice>): Invoice;
}

export interface InvoiceDocumentRepositoryContract {
  save(document: Partial<InvoiceDocument>): Promise<InvoiceDocument>;
}

export interface InvoiceServiceDependencies {
  invoiceRepository: InvoiceRepositoryContract;
  ipfsService: IPFSService;
  /** Optional: when provided, `uploadDocument` also records the upload here
   * (issue #589's bulk export reads from this table). Omitted by existing
   * callers/tests keeps the previous single-`ipfsHash` behaviour unchanged. */
  invoiceDocumentRepository?: InvoiceDocumentRepositoryContract;
  /** Notified with the invoice once it goes PUBLISHED, so auto-invest rules
   * can be evaluated against it (issue #596). */
  onInvoicePublished?: (invoice: Invoice) => void;
}

export interface UploadDocumentInput {
  invoiceId: string;
  sellerId: string;
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  docType?: string;
}

export interface UploadDocumentResult {
  invoiceId: string;
  ipfsHash: string;
  fileSize: number;
  uploadedAt: string;
}

export interface CreateInvoiceInput {
  sellerId: string;
  invoiceNumber: string;
  customerName: string;
  amount: string;
  discountRate: string;
  dueDate: Date;
  ipfsHash?: string;
  riskScore?: string;
}

export interface UpdateInvoiceInput {
  sellerId: string;
  invoiceId: string;
  customerName?: string;
  amount?: string;
  discountRate?: string;
  dueDate?: Date;
  riskScore?: string;
}

export interface PublishInvoiceInput {
  invoiceId: string;
  sellerId: string;
}

export interface InvoiceDTO {
  id: string;
  sellerId: string;
  invoiceNumber: string;
  customerName: string;
  amount: string;
  discountRate: string;
  netAmount: string;
  dueDate: Date;
  status: InvoiceStatus;
  ipfsHash: string | null;
  riskScore: string | null;
  smartContractId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GetInvoicesOptions {
  sellerId: string;
  status?: InvoiceStatus;
  skip?: number;
  take?: number;
}

/**
 * Valid state transitions for InvoiceStatus
 */
const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.PENDING, InvoiceStatus.PUBLISHED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PENDING]: [InvoiceStatus.PUBLISHED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PUBLISHED]: [InvoiceStatus.FUNDED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.FUNDED]: [InvoiceStatus.SETTLED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.SETTLED]: [],
  [InvoiceStatus.CANCELLED]: [],
};

export class InvoiceService {
  private readonly invoiceRepository: InvoiceRepositoryContract;
  private readonly ipfsService: IPFSService;
  private readonly invoiceDocumentRepository?: InvoiceDocumentRepositoryContract;
  private readonly onInvoicePublished?: (invoice: Invoice) => void;

  constructor(dependencies: InvoiceServiceDependencies) {
    this.invoiceRepository = dependencies.invoiceRepository;
    this.ipfsService = dependencies.ipfsService;
    this.invoiceDocumentRepository = dependencies.invoiceDocumentRepository;
    this.onInvoicePublished = dependencies.onInvoicePublished;
  }

  /**
   * Calculate net_amount from amount and discount_rate
   * Formula: net_amount = amount - (amount * discount_rate / 100)
   */
  private calculateNetAmount(amount: string, discountRate: string): string {
    const amountNum = parseFloat(amount);
    const discountNum = parseFloat(discountRate);
    const netAmount = amountNum - amountNum * (discountNum / 100);
    return netAmount.toFixed(4);
  }

  /**
   * Check if a status transition is valid
   */
  private isValidTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }

  /**
   * Create a new invoice
   */
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceDTO> {
    // Check invoice number uniqueness
    const existing = await this.invoiceRepository.findOneBy({
      invoiceNumber: input.invoiceNumber,
    });

    if (existing) {
      throw new ServiceError("invoice_number_exists", "Invoice number must be unique", 409);
    }

    // Calculate net amount
    const netAmount = this.calculateNetAmount(input.amount, input.discountRate);

    // Create new invoice
    const invoice = this.invoiceRepository.create({
      sellerId: input.sellerId,
      invoiceNumber: input.invoiceNumber,
      customerName: input.customerName,
      amount: input.amount,
      discountRate: input.discountRate,
      netAmount,
      dueDate: input.dueDate,
      ipfsHash: input.ipfsHash || null,
      riskScore: input.riskScore || null,
      status: InvoiceStatus.DRAFT,
    } as Partial<Invoice>);

    const saved = await this.invoiceRepository.save(invoice);
    return this.toDTO(saved);
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(invoiceId: string, sellerId?: string): Promise<InvoiceDTO | null> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return null;
    }

    // If sellerId provided, verify ownership
    if (sellerId && invoice.sellerId !== sellerId) {
      throw new ServiceError(
        "unauthorized_invoice_access",
        "You do not have access to this invoice",
        403
      );
    }

    return this.toDTO(invoice);
  }

  /**
   * Get all invoices for a seller, with optional filtering
   */
  async getInvoicesBySellerId(options: GetInvoicesOptions): Promise<{
    invoices: InvoiceDTO[];
    total: number;
  }> {
    const where: { sellerId: string; status?: InvoiceStatus; deletedAt: null } = {
      sellerId: options.sellerId,
      deletedAt: null,
    };

    if (options.status) {
      where.status = options.status;
    }

    const [invoices, total] = await Promise.all([
      this.invoiceRepository.find({
        where,
        skip: options.skip || 0,
        take: options.take || 20,
        order: { createdAt: "DESC" },
      }),
      this.invoiceRepository.count({ where }),
    ]);

    return {
      invoices: invoices.map((inv) => this.toDTO(inv)),
      total,
    };
  }

  /**
   * Update an invoice (only draft invoices can be updated)
   */
  async updateInvoice(input: UpdateInvoiceInput): Promise<InvoiceDTO> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: input.invoiceId },
    });

    if (!invoice) {
      throw new ServiceError("invoice_not_found", "Invoice not found", 404);
    }

    // Verify ownership
    if (invoice.sellerId !== input.sellerId) {
      throw new ServiceError(
        "unauthorized_invoice_access",
        "You can only update your own invoices",
        403
      );
    }

    // Only draft invoices can be updated
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new ServiceError(
        "invalid_invoice_status",
        `Cannot update invoice in ${invoice.status} status. Only draft invoices can be updated.`,
        400
      );
    }

    // Update fields
    if (input.customerName) {
      invoice.customerName = input.customerName;
    }
    if (input.amount) {
      invoice.amount = input.amount;
      invoice.discountRate = input.discountRate || invoice.discountRate;
      invoice.netAmount = this.calculateNetAmount(invoice.amount, invoice.discountRate);
    } else if (input.discountRate) {
      invoice.discountRate = input.discountRate;
      invoice.netAmount = this.calculateNetAmount(invoice.amount, invoice.discountRate);
    }
    if (input.dueDate) {
      invoice.dueDate = input.dueDate;
    }
    if (input.riskScore) {
      invoice.riskScore = input.riskScore;
    }

    const updated = await this.invoiceRepository.save(invoice);
    return this.toDTO(updated);
  }

  /**
   * Soft delete an invoice
   */
  async deleteInvoice(invoiceId: string, sellerId: string): Promise<void> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new ServiceError("invoice_not_found", "Invoice not found", 404);
    }

    // Verify ownership
    if (invoice.sellerId !== sellerId) {
      throw new ServiceError(
        "unauthorized_invoice_access",
        "You can only delete your own invoices",
        403
      );
    }

    // Only draft and cancelled invoices can be deleted
    if (invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.CANCELLED) {
      throw new ServiceError(
        "invalid_invoice_status",
        `Cannot delete invoice in ${invoice.status} status`,
        400
      );
    }

    invoice.deletedAt = new Date();
    await this.invoiceRepository.save(invoice);
  }

  /**
   * Publish an invoice (transition from DRAFT to PUBLISHED)
   */
  async publishInvoice(input: PublishInvoiceInput): Promise<InvoiceDTO> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: input.invoiceId },
      relations: ["seller"],
    });

    if (!invoice) {
      throw new ServiceError("invoice_not_found", "Invoice not found", 404);
    }

    // Verify ownership
    if (invoice.sellerId !== input.sellerId) {
      throw new ServiceError(
        "unauthorized_invoice_access",
        "You can only publish your own invoices",
        403
      );
    }

    // Check KYC status
    const seller = invoice.seller as unknown as User;
    if (!seller || seller.kycStatus !== KYCStatus.APPROVED) {
      throw new ServiceError(
        "kyc_approval_required",
        "KYC approval is required to publish invoices",
        403
      );
    }

    // Check if transition is valid
    if (!this.isValidTransition(invoice.status, InvoiceStatus.PUBLISHED)) {
      throw new ServiceError(
        "invalid_status_transition",
        `Cannot transition from ${invoice.status} to ${InvoiceStatus.PUBLISHED}`,
        400
      );
    }

    const validationErrors = validateInvoiceForPublish(invoice);
    if (validationErrors.length > 0) {
      throw new ServiceError(
        "invoice_not_publishable",
        `Invoice failed pre-publish validation: ${validationErrors.map((e) => e.message).join(" ")}`,
        400,
      );
    }

    invoice.status = InvoiceStatus.PUBLISHED;
    const updated = await this.invoiceRepository.save(invoice);
    this.onInvoicePublished?.(updated);
    return this.toDTO(updated);
  }

  /**
   * Upload document (IPFS)
   */
  async uploadDocument(input: UploadDocumentInput): Promise<UploadDocumentResult> {
    // Find the invoice
    const invoice = await this.invoiceRepository.findOne({
      where: { id: input.invoiceId },
    });
    if (!invoice) {
      throw new ServiceError("invoice_not_found", "Invoice not found", 404);
    }

    // Verify ownership
    if (invoice.sellerId !== input.sellerId) {
      throw new ServiceError(
        "unauthorized_invoice_access",
        "You can only upload documents to your own invoices",
        403
      );
    }

    // Upload to IPFS
    const uploadResult: IPFSUploadResult = await this.ipfsService.uploadFile(
      input.fileBuffer,
      input.filename,
      input.mimeType,
      input.invoiceId
    );

    // Update invoice with IPFS hash
    invoice.ipfsHash = uploadResult.hash;
    await this.invoiceRepository.save(invoice);

    // Also record it as one of possibly several documents on this invoice
    // (issue #589's bulk export reads from this table). Best-effort: a
    // document-tracking failure must not roll back an upload that already
    // succeeded against IPFS and the invoice's own ipfsHash.
    if (this.invoiceDocumentRepository) {
      await this.invoiceDocumentRepository.save({
        invoiceId: input.invoiceId,
        cid: uploadResult.hash,
        docType: input.docType ?? "general",
        filename: input.filename,
        mimeType: input.mimeType,
        fileSize: uploadResult.size,
      });
    }

    return {
      invoiceId: input.invoiceId,
      ipfsHash: uploadResult.hash,
      fileSize: uploadResult.size,
      uploadedAt: uploadResult.timestamp,
    };
  }

  /**
   * Convert Invoice model to DTO
   */
  private toDTO(invoice: Invoice): InvoiceDTO {
    return {
      id: invoice.id,
      sellerId: invoice.sellerId,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName,
      amount: invoice.amount,
      discountRate: invoice.discountRate,
      netAmount: invoice.netAmount,
      dueDate: invoice.dueDate,
      status: invoice.status,
      ipfsHash: invoice.ipfsHash,
      riskScore: invoice.riskScore,
      smartContractId: invoice.smartContractId,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }
}

export function createInvoiceService(
  dataSource: DataSource,
  ipfsService: IPFSService,
  onInvoicePublished?: (invoice: Invoice) => void,
): InvoiceService {
  const invoiceRepository = dataSource.getRepository(Invoice);
  const invoiceDocumentRepository = dataSource.getRepository(InvoiceDocument);

  return new InvoiceService({
    invoiceRepository,
    ipfsService,
    invoiceDocumentRepository,
    onInvoicePublished,
  });
}
