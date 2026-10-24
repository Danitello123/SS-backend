import { DataSource } from "typeorm";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import archiver from "archiver";
import { Invoice } from "../models/Invoice.model";
import { InvoiceDocument } from "../models/InvoiceDocument.model";
import { Investment } from "../models/Investment.model";
import { User } from "../models/User.model";
import { KYCStatus } from "../types/enums";
import { ServiceError } from "../utils/service-error";
import type { IPFSService } from "./ipfs.service";
import { createSignedDownloadToken, verifySignedDownloadToken } from "../lib/signed-url";

export type ExportJobStatus = "processing" | "completed" | "failed";

export interface ExportJob {
  id: string;
  invoiceId: string;
  status: ExportJobStatus;
  zipPath?: string;
  downloadToken?: string;
  downloadTokenExpiresAt?: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface DocumentExportServiceDependencies {
  dataSource: DataSource;
  ipfsService: IPFSService;
  tempDir: string;
  signingSecret: string;
  urlTtlMinutes: number;
}

/** Characters outside `[A-Za-z0-9._-]` are not safe in a ZIP entry/file name across platforms. */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function extensionFor(filename: string, mimeType: string): string {
  const existing = path.extname(filename);
  if (existing) return existing;
  const byMime: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };
  return byMime[mimeType] ?? "";
}

/**
 * Bulk document export (issue #589): fetches every document pinned for an
 * invoice, packages them into a ZIP, and hands back a signed download URL.
 *
 * Generation runs as a background job (`requestExport` returns immediately
 * with a job id; `getJobStatus` polls it) because fetching N documents from
 * an IPFS gateway is network-bound and the issue's own acceptance criteria
 * calls out "Large document sets (10+ files) handled without timeout" --
 * exactly the case a synchronous request handler would be most likely to
 * blow a client or proxy timeout on.
 */
export class DocumentExportService {
  private readonly jobs = new Map<string, ExportJob>();

  constructor(private readonly dependencies: DocumentExportServiceDependencies) {}

  /** Starts generating the ZIP in the background and returns a job id immediately. */
  async requestExport(invoiceId: string, requestingUserId: string): Promise<{ jobId: string }> {
    const invoice = await this.dependencies.dataSource
      .getRepository(Invoice)
      .findOneBy({ id: invoiceId });
    if (!invoice) {
      throw new ServiceError("invoice_not_found", "Invoice not found", 404);
    }

    await this.assertEligible(invoice, requestingUserId);

    const jobId = `exp_${invoiceId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const job: ExportJob = {
      id: jobId,
      invoiceId,
      status: "processing",
      createdAt: Date.now(),
    };
    this.jobs.set(jobId, job);

    // Fire-and-forget: the caller polls `getJobStatus`, it does not await this.
    void this.runExport(job, invoice.invoiceNumber);

    return { jobId };
  }

  getJobStatus(jobId: string): ExportJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Streams the ZIP for a completed job, after verifying `token` against
   * the signed URL issued when the job completed. Returns the file path on
   * success; throws on an unknown job, a job that is not done, or an
   * invalid/expired token.
   */
  getDownloadPath(jobId: string, token: string): string {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "completed" || !job.zipPath) {
      throw new ServiceError("export_not_ready", "Export job is not ready for download", 404);
    }

    const valid = verifySignedDownloadToken(
      this.dependencies.signingSecret,
      jobId,
      token,
    );
    if (!valid) {
      throw new ServiceError("invalid_download_token", "Download link is invalid or has expired", 403);
    }

    return job.zipPath;
  }

  private async assertEligible(invoice: Invoice, requestingUserId: string): Promise<void> {
    const user = await this.dependencies.dataSource
      .getRepository(User)
      .findOneBy({ id: requestingUserId });
    if (!user) {
      throw new ServiceError("user_not_found", "User not found", 404);
    }
    if (user.kycStatus !== KYCStatus.APPROVED) {
      throw new ServiceError("kyc_not_approved", "KYC approval required to export documents", 403);
    }

    const isIssuer = invoice.sellerId === requestingUserId;
    if (isIssuer) return;

    const hasInvested = await this.dependencies.dataSource.getRepository(Investment).exists({
      where: { invoiceId: invoice.id, investorId: requestingUserId },
    });
    if (!hasInvested) {
      throw new ServiceError(
        "export_forbidden",
        "Only the issuer or an investor in this invoice may export its documents",
        403,
      );
    }
  }

  private async runExport(job: ExportJob, invoiceNumber: string): Promise<void> {
    try {
      const documents = await this.dependencies.dataSource
        .getRepository(InvoiceDocument)
        .find({ where: { invoiceId: job.invoiceId }, order: { createdAt: "ASC" } });

      if (documents.length === 0) {
        throw new ServiceError("no_documents", "This invoice has no documents to export", 404);
      }

      await fs.mkdir(this.dependencies.tempDir, { recursive: true });
      const zipPath = path.join(this.dependencies.tempDir, `${job.id}.zip`);

      await this.writeZip(zipPath, job.invoiceId, invoiceNumber, documents);

      const { token, expiresAt } = createSignedDownloadToken(
        this.dependencies.signingSecret,
        job.id,
        this.dependencies.urlTtlMinutes,
      );

      job.status = "completed";
      job.zipPath = zipPath;
      job.downloadToken = token;
      job.downloadTokenExpiresAt = expiresAt;
      job.completedAt = Date.now();
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Unknown error";
      job.completedAt = Date.now();
    }
  }

  private async writeZip(
    zipPath: string,
    invoiceId: string,
    invoiceNumber: string,
    documents: InvoiceDocument[],
  ): Promise<void> {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    const done = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
    });
    archive.pipe(output);

    const invoiceLabel = sanitizeForFilename(invoiceNumber || invoiceId);
    const seenNames = new Map<string, number>();

    for (const doc of documents) {
      const fileBuffer = await this.dependencies.ipfsService.fetchFile(doc.cid);

      const dateStamp = doc.createdAt.toISOString().slice(0, 10);
      const docType = sanitizeForFilename(doc.docType);
      const extension = extensionFor(doc.filename, doc.mimeType);
      let entryName = `${invoiceLabel}_${docType}_${dateStamp}${extension}`;

      // Structured naming can collide when an invoice has two documents of
      // the same type uploaded the same day; disambiguate rather than let
      // archiver silently overwrite one entry with the other.
      const count = seenNames.get(entryName) ?? 0;
      seenNames.set(entryName, count + 1);
      if (count > 0) {
        entryName = `${invoiceLabel}_${docType}_${dateStamp}_${count + 1}${extension}`;
      }

      archive.append(fileBuffer, { name: entryName });
    }

    await archive.finalize();
    await done;
  }
}

export function createDocumentExportService(
  dependencies: DocumentExportServiceDependencies,
): DocumentExportService {
  return new DocumentExportService(dependencies);
}
