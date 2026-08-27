import { SorobanRpc, scValToNative, xdr } from "stellar-sdk";
import { createHash } from "crypto";
import type { DataSource, Repository } from "typeorm";
import type { AppLogger } from "../../observability/logger";
import { logger as globalLogger } from "../../observability/logger";
import { SorobanEventLog } from "../../models/SorobanEventLog.model";
import { SorobanIndexerCheckpoint } from "../../models/SorobanIndexerCheckpoint.model";
import { Invoice } from "../../models/Invoice.model";
import { Investment } from "../../models/Investment.model";
import { InvoiceStatus } from "../../types/enums";
import type { DecodedSorobanEvent } from "../../types/soroban.types";
import type { InvestorInsightsService } from "../investor-insights.service";

export interface EventIndexerServiceDependencies {
  contractIds: string[];
  rpcUrl?: string;
  server?: SorobanRpc.Server;
  dataSource?: DataSource;
  logger?: AppLogger;
  eventLogRepository?: Repository<SorobanEventLog>;
  invoiceRepository?: Repository<Invoice>;
  investmentRepository?: Repository<Investment>;
  investorInsightsService?: InvestorInsightsService;
}

export interface PollEventsOptions {
  startLedger?: number;
  limit?: number;
  cursor?: string;
}

export class EventIndexerService {
  readonly contractIds: string[];
  private readonly rpcServer: SorobanRpc.Server;
  private readonly dataSource?: DataSource;
  private readonly logger: AppLogger;
  private readonly eventLogRepository?: Repository<SorobanEventLog>;
  private readonly invoiceRepository?: Repository<Invoice>;
  private readonly investmentRepository?: Repository<Investment>;
  private readonly investorInsightsService?: InvestorInsightsService;
  private readonly checkpointRepository?: Repository<SorobanIndexerCheckpoint>;
  private readonly checkpointId: string;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastIndexedLedger = 0;
  private latestObservedLedger = 0;
  private polling = false;

  constructor(dependencies: EventIndexerServiceDependencies) {
    if (!dependencies.contractIds || dependencies.contractIds.length === 0) {
      throw new Error("At least one contractId is required.");
    }
    if (dependencies.contractIds.length > 25) {
      throw new Error("Soroban RPC supports at most 25 contract IDs per event indexer.");
    }
    this.contractIds = dependencies.contractIds;
    this.checkpointId = createHash("sha256")
      .update([...dependencies.contractIds].sort().join(","))
      .digest("hex");
    this.logger = dependencies.logger ?? globalLogger;
    this.dataSource = dependencies.dataSource;
    this.investorInsightsService = dependencies.investorInsightsService;

    if (dependencies.server) {
      this.rpcServer = dependencies.server;
    } else {
      const url = dependencies.rpcUrl ?? "https://soroban-testnet.stellar.org";
      this.rpcServer = new SorobanRpc.Server(url, {
        allowHttp: url.startsWith("http://"),
      });
    }

    if (dependencies.eventLogRepository) {
      this.eventLogRepository = dependencies.eventLogRepository;
    } else if (this.dataSource) {
      this.eventLogRepository = this.dataSource.getRepository(SorobanEventLog);
    }

    if (dependencies.invoiceRepository) {
      this.invoiceRepository = dependencies.invoiceRepository;
    } else if (this.dataSource) {
      this.invoiceRepository = this.dataSource.getRepository(Invoice);
    }

    if (dependencies.investmentRepository) {
      this.investmentRepository = dependencies.investmentRepository;
    } else if (this.dataSource) {
      this.investmentRepository = this.dataSource.getRepository(Investment);
    }

    if (this.dataSource) {
      this.checkpointRepository = this.dataSource.getRepository(SorobanIndexerCheckpoint);
    }
  }

  /**
   * Decodes a raw Soroban event from RPC getEvents response into structured JS object.
   */
  public decodeEvent(rawEvent: SorobanRpc.Api.GetEventsResponse["events"][0]): DecodedSorobanEvent {
    const decodedTopics: unknown[] = [];

    if (rawEvent.topic) {
      for (const topicXdr of rawEvent.topic) {
        try {
          const scVal =
            typeof topicXdr === "string"
              ? xdr.ScVal.fromXDR(topicXdr, "base64")
              : (topicXdr as unknown as xdr.ScVal);
          decodedTopics.push(scValToNative(scVal));
        } catch {
          decodedTopics.push(topicXdr);
        }
      }
    }

    let decodedData: unknown = null;
    if (rawEvent.value) {
      try {
        const scVal =
          typeof rawEvent.value === "string"
            ? xdr.ScVal.fromXDR(rawEvent.value, "base64")
            : (rawEvent.value as unknown as xdr.ScVal);
        decodedData = scValToNative(scVal);
      } catch {
        decodedData = rawEvent.value;
      }
    }

    const primaryTopic =
      decodedTopics.length > 0 && typeof decodedTopics[0] === "string"
        ? (decodedTopics[0] as string)
        : String(decodedTopics[0] ?? "unknown");

    const rawRecord = rawEvent as unknown as Record<string, unknown>;
    const contractIdStr = rawEvent.contractId
      ? typeof rawRecord.contractId === "string"
        ? (rawRecord.contractId as string)
        : typeof (rawEvent.contractId as unknown as { contractId?: () => string }).contractId === "function"
        ? (rawEvent.contractId as unknown as { contractId: () => string }).contractId()
        : String(rawEvent.contractId)
      : "";

    const txHash =
      typeof rawRecord.txHash === "string"
        ? rawRecord.txHash
        : typeof rawRecord.pagingToken === "string"
        ? rawRecord.pagingToken
        : rawEvent.id;

    return {
      id: rawEvent.id,
      contractId: contractIdStr,
      ledger: Number(rawEvent.ledger),
      ledgerClosedAt: rawEvent.ledgerClosedAt,
      txHash,
      topic: primaryTopic,
      topics: decodedTopics,
      data: decodedData,
      inSuccessfulContractCall: rawEvent.inSuccessfulContractCall ?? true,
    };
  }

  /**
   * Polls contract events from Soroban RPC matching configured contract IDs.
   */
  public async pollContractEvents(
    options: PollEventsOptions = {},
  ): Promise<DecodedSorobanEvent[]> {
    const startLedger =
      options.startLedger ?? (await this.getLastIndexedLedger()) + 1;

    try {
      const filters: NonNullable<SorobanRpc.Server.GetEventsRequest["filters"]> = [];
      for (let index = 0; index < this.contractIds.length; index += 5) {
        filters.push({
          type: "contract",
          contractIds: this.contractIds.slice(index, index + 5),
        });
      }

      const requestParams: SorobanRpc.Server.GetEventsRequest = {
        filters,
        limit: options.limit ?? 100,
      };

      if (startLedger > 1 && !options.cursor) {
        requestParams.startLedger = startLedger;
      }

      let cursor = options.cursor;
      const seenCursors = new Set<string>();
      const decodedEvents: DecodedSorobanEvent[] = [];
      do {
        const params: SorobanRpc.Server.GetEventsRequest = { ...requestParams };
        if (cursor) {
          params.cursor = cursor;
          delete params.startLedger;
        }
        const response = await this.rpcServer.getEvents(params);
        const responseWithCursor = response as SorobanRpc.Api.GetEventsResponse & {
          cursor?: string;
        };
        this.latestObservedLedger = Math.max(
          this.latestObservedLedger,
          response.latestLedger ?? 0,
        );
        decodedEvents.push(...(response.events ?? []).map((event) => this.decodeEvent(event)));
        const nextCursor = responseWithCursor.cursor;
        if (!nextCursor || nextCursor === cursor) break;
        if (seenCursors.has(nextCursor)) {
          throw new Error("Soroban RPC returned a repeated event cursor.");
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } while (cursor);

      this.logger.info("Polled Soroban contract events", {
        startLedger,
        eventCount: decodedEvents.length,
      });

      return decodedEvents;
    } catch (error) {
      this.logger.error("Failed to poll Soroban contract events", {
        err: error,
        startLedger,
      });
      throw error;
    }
  }

  /**
   * Ingests, persists, and reconciles a list of decoded Soroban events into the database.
   */
  public async ingestEvents(events: DecodedSorobanEvent[]): Promise<number> {
    let processedCount = 0;
    let highestProcessedLedger = this.lastIndexedLedger;

    for (const event of events) {
      const eventId = event.id || `${event.txHash}:${event.topic}:${event.ledger}`;
      try {
        const existingLog = this.eventLogRepository
          ? await this.eventLogRepository.findOne({ where: { eventId } })
          : null;
        if (existingLog?.processed) {
          highestProcessedLedger = Math.max(highestProcessedLedger, event.ledger);
          continue;
        }

        if (this.eventLogRepository) {
          if (existingLog) {
            await this.eventLogRepository.update({ eventId }, { processed: false });
          } else {
            const logEntry = this.eventLogRepository.create({
              eventId,
              contractId: event.contractId,
              ledgerSequence: event.ledger.toString(),
              topic: event.topic,
              txHash: event.txHash,
              payload: {
                topics: event.topics,
                data: event.data,
                ledgerClosedAt: event.ledgerClosedAt,
              },
              processed: false,
            });
            await this.eventLogRepository.save(logEntry);
          }
        }

        // Apply state transitions based on event topics
        await this.applyEventStateTransition(event);
        await this.investorInsightsService?.processEvent(event);

        if (this.eventLogRepository) {
          await this.eventLogRepository.update(
            { eventId },
            { processed: true },
          );
        }

        highestProcessedLedger = Math.max(highestProcessedLedger, event.ledger);
        processedCount++;
      } catch (err) {
        this.logger.error("Error processing Soroban event", {
          err,
          eventId: event.id,
          topic: event.topic,
        });
        throw err;
      }
    }

    this.lastIndexedLedger = highestProcessedLedger;
    const checkpointLedger = Math.max(highestProcessedLedger, this.latestObservedLedger);
    if (checkpointLedger > 0 && this.checkpointRepository) {
      await this.checkpointRepository.save(this.checkpointRepository.create({
        indexerId: this.checkpointId,
        ledgerSequence: checkpointLedger.toString(),
      }));
      this.lastIndexedLedger = checkpointLedger;
    }
    return processedCount;
  }

  /**
   * Applies domain state updates to Invoice / Investment models based on on-chain event topics.
   */
  private async applyEventStateTransition(event: DecodedSorobanEvent): Promise<void> {
    const topic = event.topic.toLowerCase();

    // Event: "create_escrow"
    if (topic === "create_escrow") {
      const invoiceId = this.extractInvoiceId(event);
      if (invoiceId && this.invoiceRepository) {
        const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
        if (invoice && invoice.status === InvoiceStatus.DRAFT) {
          invoice.status = InvoiceStatus.PUBLISHED;
          await this.invoiceRepository.save(invoice);
        }
      }
    }

    // Event: "fund_escrow" or "fund"
    if (topic === "fund_escrow" || topic === "fund") {
      const invoiceId = this.extractInvoiceId(event);
      if (invoiceId && this.invoiceRepository) {
        const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
        if (invoice && invoice.status === InvoiceStatus.PUBLISHED) {
          invoice.status = InvoiceStatus.FUNDED;
          await this.invoiceRepository.save(invoice);
        }
      }
    }

    // Event: "payment_recorded" or "payment"
    if (topic === "payment_recorded" || topic === "payment") {
      const invoiceId = this.extractInvoiceId(event);
      if (invoiceId && this.invoiceRepository) {
        const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
        if (invoice && invoice.status === InvoiceStatus.FUNDED) {
          invoice.status = InvoiceStatus.SETTLED;
          await this.invoiceRepository.save(invoice);
        }
      }
    }

    // Event: "settle_escrow" or "settle"
    if (topic === "settle_escrow" || topic === "settle") {
      const invoiceId = this.extractInvoiceId(event);
      if (invoiceId && this.invoiceRepository) {
        const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
        if (invoice) {
          invoice.status = InvoiceStatus.SETTLED;
          await this.invoiceRepository.save(invoice);
        }
      }
    }
  }

  private extractInvoiceId(event: DecodedSorobanEvent): string | null {
    if (event.topics.length > 1 && typeof event.topics[1] === "string") {
      return event.topics[1];
    }
    if (event.data && typeof event.data === "object") {
      const dataObj = event.data as Record<string, unknown>;
      if ("invoice_id" in dataObj) {
        return String(dataObj.invoice_id);
      }
    }
    return null;
  }

  /**
   * Retrieves the last processed ledger sequence number.
   */
  public async getLastIndexedLedger(): Promise<number> {
    if (this.lastIndexedLedger > 0) {
      return this.lastIndexedLedger;
    }

    if (this.eventLogRepository) {
      const checkpoint = this.checkpointRepository
        ? await this.checkpointRepository.findOne({ where: { indexerId: this.checkpointId } })
        : null;
      const latest = await this.eventLogRepository.findOne({
        where: { processed: true },
        order: { ledgerSequence: "DESC" },
      });
      const pending = await this.eventLogRepository.findOne({
        where: { processed: false },
        order: { ledgerSequence: "ASC" },
      });
      let ledger = checkpoint?.ledgerSequence
        ? Number(checkpoint.ledgerSequence)
        : latest?.ledgerSequence ? Number(latest.ledgerSequence) : 0;
      if (pending?.processed === false) {
        const beforePending = Number(pending.ledgerSequence) - 1;
        ledger = ledger > 0 ? Math.min(ledger, beforePending) : beforePending;
      }
      this.lastIndexedLedger = Math.max(0, ledger);
      return this.lastIndexedLedger;
    }

    return 0;
  }

  /**
   * Starts periodic polling in background.
   */
  public start(intervalMs = 10000): void {
    if (this.intervalHandle) return;

    this.logger.info("Starting Soroban event indexer service", {
      contractIds: this.contractIds,
      intervalMs,
    });

    this.intervalHandle = setInterval(async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        const events = await this.pollContractEvents();
        await this.ingestEvents(events);
      } catch (err) {
        this.logger.error("Error in Soroban event indexer poll cycle", { err });
      } finally {
        this.polling = false;
      }
    }, intervalMs);
  }

  /**
   * Stops periodic polling.
   */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info("Stopped Soroban event indexer service");
    }
  }
}
