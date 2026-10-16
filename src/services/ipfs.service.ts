import type { AppConfig } from "../config/env";
import { ServiceError } from "../utils/service-error";
import type { AppLogger } from "../observability/logger";

export interface IPFSUploadResult {
  hash: string;
  size: number;
  timestamp: string;
}

export interface IPFSServiceDependencies {
  config: AppConfig["ipfs"];
  logger: AppLogger;
  fetchImplementation?: typeof fetch;
}

export interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

export class IPFSService {
  private readonly config: AppConfig["ipfs"];
  private readonly logger: AppLogger;
  private readonly fetchImplementation: typeof fetch;

  constructor(dependencies: IPFSServiceDependencies) {
    this.config = dependencies.config;
    this.logger = dependencies.logger;
    this.fetchImplementation = dependencies.fetchImplementation ?? fetch;
  }

  async uploadFile(
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
    invoiceId?: string
  ): Promise<IPFSUploadResult> {
    // Validate file size
    const fileSizeMB = fileBuffer.length / (1024 * 1024);
    if (fileSizeMB > this.config.maxFileSizeMB) {
      throw new ServiceError(
        "file_too_large",
        `File size ${fileSizeMB.toFixed(2)}MB exceeds maximum allowed size of ${this.config.maxFileSizeMB}MB`,
        400
      );
    }

    // Validate MIME type
    if (!this.config.allowedMimeTypes.includes(mimeType)) {
      throw new ServiceError(
        "invalid_file_type",
        `File type ${mimeType} is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(", ")}`,
        400
      );
    }

    try {
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: mimeType });
      formData.append("file", blob, filename);

      const response = await this.fetchImplementation(
        `${this.config.apiUrl}/pinning/pinFileToIPFS`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.jwt}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const errorReason = `${response.status} ${response.statusText}`;

        this.logger.warn("IPFS document upload failed", {
          invoice_id: invoiceId,
          error_reason: errorReason,
          failed_at: new Date().toISOString(),
        });

        throw new ServiceError(
          "ipfs_upload_failed",
          `IPFS upload failed: ${errorReason} - ${errorText}`,
          502
        );
      }

      const result = (await response.json()) as PinataResponse;

      this.logger.info("IPFS document upload completed", {
        cid: result.IpfsHash,
        invoice_id: invoiceId,
        file_size_bytes: result.PinSize,
        uploaded_at: result.Timestamp,
      });

      return {
        hash: result.IpfsHash,
        size: result.PinSize,
        timestamp: result.Timestamp,
      };
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.logger.warn("IPFS document upload failed", {
        invoice_id: invoiceId,
        error_reason: errorMessage,
        failed_at: new Date().toISOString(),
      });

      throw new ServiceError(
        "ipfs_upload_error",
        `Failed to upload file to IPFS: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Downloads one previously-pinned file by CID from the configured IPFS
   * gateway (issue #589's bulk export needs the bytes back, not just a CID).
   */
  async fetchFile(cid: string): Promise<Buffer> {
    const url = `${this.config.gatewayUrl.replace(/\/+$/, "")}/${cid}`;

    let response: Response;
    try {
      response = await this.fetchImplementation(url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn("IPFS document fetch failed", { cid, error_reason: errorMessage });
      throw new ServiceError("ipfs_fetch_error", `Failed to fetch ${cid} from IPFS gateway: ${errorMessage}`, 502);
    }

    if (!response.ok) {
      const errorReason = `${response.status} ${response.statusText}`;
      this.logger.warn("IPFS document fetch failed", { cid, error_reason: errorReason });
      throw new ServiceError("ipfs_fetch_failed", `IPFS gateway fetch failed for ${cid}: ${errorReason}`, 502);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export function createIPFSService(config: AppConfig["ipfs"], logger: AppLogger): IPFSService {
  return new IPFSService({ config, logger });
}
