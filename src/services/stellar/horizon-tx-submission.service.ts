import type { AppLogger } from "../../observability/logger";
import { ServiceError } from "../../utils/service-error";

export interface HorizonTxSubmissionDependencies {
  horizonUrl: string;
  logger: AppLogger;
  fetchImplementation?: typeof fetch;
  maxRetries?: number;
  initialBackoffMs?: number;
}

export interface HorizonSubmissionResult {
  hash: string;
  ledger: number;
  successful: boolean;
  envelopeXdr: string;
  resultXdr: string;
}

export class HorizonTxSubmissionService {
  private readonly horizonUrl: string;
  private readonly logger: AppLogger;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  constructor(deps: HorizonTxSubmissionDependencies) {
    this.horizonUrl = deps.horizonUrl.replace(/\/$/, "");
    this.logger = deps.logger;
    this.fetchImplementation = deps.fetchImplementation ?? fetch;
    this.maxRetries = deps.maxRetries ?? 3;
    this.initialBackoffMs = deps.initialBackoffMs ?? 1_000;
  }

  /**
   * Submit signed transaction XDR envelope to Horizon API with exponential retry (#598).
   */
  async submitTxWithRetry(signedXdr: string): Promise<HorizonSubmissionResult> {
    let attempt = 0;
    let delay = this.initialBackoffMs;

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const body = new URLSearchParams();
        body.append("tx", signedXdr);

        const response = await this.fetchImplementation(`${this.horizonUrl}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            hash: string;
            ledger: number;
            successful: boolean;
            envelope_xdr: string;
            result_xdr: string;
          };
          this.logger.info("Transaction submitted successfully to Horizon", {
            hash: data.hash,
            ledger: data.ledger,
            attempt,
          });
          return {
            hash: data.hash,
            ledger: data.ledger,
            successful: data.successful,
            envelopeXdr: data.envelope_xdr,
            resultXdr: data.result_xdr,
          };
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt <= this.maxRetries) {
            this.logger.warn(`Transient Horizon error ${response.status}; retrying in ${delay}ms`, { attempt });
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
        }

        const errorText = await response.text();
        throw new ServiceError("HORIZON_SUBMISSION_REJECTED", `Horizon rejected transaction (${response.status}): ${errorText}`, 400);
      } catch (err) {
        if (err instanceof ServiceError) throw err;
        if (attempt <= this.maxRetries) {
          this.logger.warn(`Network error during Horizon transaction submission: ${err}`, { attempt });
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw new ServiceError("HORIZON_SUBMISSION_FAILED", `Failed to submit transaction after ${attempt} attempts: ${err}`, 503);
      }
    }

    throw new ServiceError("HORIZON_MAX_RETRIES_EXCEEDED", "Max submission retries exceeded", 503);
  }
}
