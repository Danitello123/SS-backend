import { HttpError } from "../utils/http-error";
import type { DecodedSorobanEvent } from "../types/soroban.types";
import type {
  KeyMergeProposal,
  KeyMergeProposalStatus,
  KeyMergeVoteTally,
  KeyMergeMigrationSummary,
} from "../models/KeyMergeProposal.model";
import type { KeyMergeVote } from "../models/KeyMergeVote.model";
import { decodeCursor, encodeCursor } from "../utils/cursor-pagination.utils";
import {
  readEventNumber,
  readEventString,
  type ContractEventHandler,
} from "./contract-event-bus.service";

export const KEY_MERGE_EVENTS = {
  proposed: "merge_proposed",
  voted: "merge_voted",
  executed: "merge_executed",
} as const;

export interface KeyMergeProposalInput {
  keyId: string;
  proposalId: string;
  contractAddress: string;
  sourceKeyId?: string | null;
  targetKeyId?: string | null;
  sourceContractAddress?: string | null;
  targetContractAddress?: string | null;
  conversionRatio: string;
  voteThreshold: string;
  votingDeadline?: Date | null;
  timelockExpiry?: Date | null;
  proposedAt: Date;
  proposalTxHash?: string | null;
  ledgerSequence?: string | null;
}

export interface KeyMergeVoteInput {
  proposalId: string;
  voterAddress: string;
  support: boolean;
  weight: string;
  txHash?: string | null;
  ledgerSequence?: string | null;
  votedAt: Date;
}

export interface KeyMergeExecutionInput {
  proposalId: string;
  migrationSummary: KeyMergeMigrationSummary;
  executedAt: Date;
  executionTxHash?: string | null;
  ledgerSequence?: string | null;
}

export interface KeyMergeCursor {
  createdAt: Date;
  id: string;
}

export interface KeyMergeProposalRepositoryContract {
  findByKeyId(
    keyId: string,
    options?: {
      status?: string;
      limit?: number;
      cursor?: KeyMergeCursor | null;
    }
  ): Promise<{ items: KeyMergeProposal[]; hasMore: boolean; total: number }>;
  findByProposalId(proposalId: string): Promise<KeyMergeProposal | null>;
  findById(id: string): Promise<KeyMergeProposal | null>;
  recordProposal(input: KeyMergeProposalInput): Promise<KeyMergeProposal | null>;
  recordVote(
    input: KeyMergeVoteInput
  ): Promise<{ proposal: KeyMergeProposal | null; vote: KeyMergeVote | null }>;
  recordExecution(input: KeyMergeExecutionInput): Promise<KeyMergeProposal | null>;
  findVotesByProposalId(proposalId: string): Promise<KeyMergeVote[]>;
}

export interface KeyMergeProposalView {
  id: string;
  proposalId: string;
  keyId: string;
  contractAddress: string;
  sourceKeyId: string | null;
  targetKeyId: string | null;
  sourceContractAddress: string | null;
  targetContractAddress: string | null;
  conversionRatio: string;
  voteThreshold: string;
  status: KeyMergeProposalStatus;
  voteTally: KeyMergeVoteTally;
  migrationSummary: KeyMergeMigrationSummary | null;
  votingDeadline: string | null;
  timelockExpiry: string | null;
  proposedAt: string;
  executedAt: string | null;
  proposalTxHash: string | null;
  executionTxHash: string | null;
  ledgerSequence: string | null;
}

export interface KeyMergeProposalListResponse {
  pending: KeyMergeProposalView[];
  completed: KeyMergeProposalView[];
  items: KeyMergeProposalView[];
  total: number;
  meta: {
    limit: number;
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface KeyMergeProposalServiceDependencies {
  keyMergeProposalRepository: KeyMergeProposalRepositoryContract;
  now?: () => Date;
}

/**
 * Tracks key merge proposals, holder vote tallies, and execution status
 * projected from Soroban contract events.
 */
export class KeyMergeProposalService implements ContractEventHandler {
  private readonly repository: KeyMergeProposalRepositoryContract;
  private readonly now: () => Date;

  constructor({
    keyMergeProposalRepository,
    now = () => new Date(),
  }: KeyMergeProposalServiceDependencies) {
    this.repository = keyMergeProposalRepository;
    this.now = now;
  }

  topics(): string[] {
    return [
      KEY_MERGE_EVENTS.proposed,
      "mergeproposed",
      "key_merge_proposed",
      KEY_MERGE_EVENTS.voted,
      "mergevoted",
      "key_merge_voted",
      "vote_recorded",
      KEY_MERGE_EVENTS.executed,
      "mergeexecuted",
      "key_merge_executed",
    ];
  }

  /**
   * GET /keys/:id/merge-proposals
   * Returns pending and completed merges with vote tallies and migration summaries.
   */
  async listForKey(
    keyId: string,
    options: {
      status?: string;
      limit?: number;
      cursor?: string | null;
    } = {}
  ): Promise<KeyMergeProposalListResponse> {
    const id = this.normalizeKeyId(keyId);
    const limit = this.normalizeLimit(options.limit);
    const status = this.normalizeStatus(options.status);

    let cursor: KeyMergeCursor | null = null;
    if (options.cursor) {
      try {
        cursor = decodeCursor(options.cursor);
      } catch {
        throw new HttpError(400, "Invalid cursor.");
      }
    }

    const { items, hasMore, total } = await this.repository.findByKeyId(id, {
      status,
      limit,
      cursor,
    });

    const views = items.map((row) => this.toView(row));
    const pending = views.filter((v) => v.status === "pending");
    const completed = views.filter((v) => v.status === "completed" || v.status === "executed");

    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.proposedAt, last.id) : null;

    return {
      pending: status === "completed" || status === "executed" ? [] : pending,
      completed: status === "pending" ? [] : completed,
      items: views,
      total: views.length,
      meta: {
        limit,
        total,
        hasMore,
        nextCursor,
      },
    };
  }

  /**
   * GET /keys/:id/merge-proposals/:proposalId
   */
  async getProposal(proposalId: string): Promise<KeyMergeProposalView> {
    if (!proposalId || !proposalId.trim()) {
      throw new HttpError(400, "A proposal id is required.");
    }

    const proposal =
      (await this.repository.findByProposalId(proposalId.trim())) ??
      (await this.repository.findById(proposalId.trim()));

    if (!proposal) {
      throw new HttpError(404, "Merge proposal not found.");
    }

    return this.toView(proposal);
  }

  /**
   * Dispatches contract events to the corresponding handler.
   */
  async handle(event: DecodedSorobanEvent): Promise<void> {
    const topic = event.topic.toLowerCase().replace(/[-\s]+/g, "_");

    if (topic.includes("proposed")) {
      await this.recordProposal(event);
      return;
    }

    if (topic.includes("vote")) {
      await this.recordVote(event);
      return;
    }

    if (topic.includes("executed")) {
      await this.recordExecution(event);
    }
  }

  private async recordProposal(event: DecodedSorobanEvent): Promise<void> {
    const keyId =
      readEventString(
        event,
        ["key_id", "keyId", "target_key_id", "targetKeyId", "creator_key_id"],
        1
      ) ?? event.contractId;
    const proposalId = readEventString(event, ["proposal_id", "proposalId", "id"], 2);
    if (!keyId || !proposalId) return;

    const conversionRatioNum = readEventNumber(event, [
      "conversion_ratio",
      "conversionRatio",
      "ratio",
    ]);
    const conversionRatio =
      readEventString(event, ["conversion_ratio", "conversionRatio", "ratio"]) ??
      (conversionRatioNum !== null ? conversionRatioNum.toFixed(7) : "1.0000000");

    const voteThresholdNum = readEventNumber(event, [
      "vote_threshold",
      "voteThreshold",
      "threshold",
    ]);
    const voteThreshold =
      readEventString(event, ["vote_threshold", "voteThreshold", "threshold"]) ??
      (voteThresholdNum !== null ? String(voteThresholdNum) : "66.67");

    const deadlineSec = readEventNumber(event, [
      "voting_deadline",
      "votingDeadline",
      "deadline",
      "timelock",
    ]);
    const votingDeadline = deadlineSec ? this.resolveDeadline(event, deadlineSec) : null;

    const sourceKeyId = readEventString(event, [
      "source_key_id",
      "sourceKeyId",
      "source_key",
      "sourceKey",
    ]);
    const targetKeyId =
      readEventString(event, ["target_key_id", "targetKeyId", "target_key", "targetKey"]) ?? keyId;

    await this.repository.recordProposal({
      keyId,
      proposalId,
      contractAddress:
        readEventString(event, ["contract_address", "contractAddress"], 3) ?? event.contractId,
      sourceKeyId,
      targetKeyId,
      sourceContractAddress: readEventString(event, [
        "source_contract",
        "source_contract_address",
        "sourceContract",
      ]),
      targetContractAddress: readEventString(event, [
        "target_contract",
        "target_contract_address",
        "targetContract",
      ]),
      conversionRatio,
      voteThreshold,
      votingDeadline,
      timelockExpiry: votingDeadline,
      proposedAt: this.eventTime(event),
      proposalTxHash: event.txHash ?? null,
      ledgerSequence: Number.isFinite(event.ledger) ? String(event.ledger) : null,
    });
  }

  private async recordVote(event: DecodedSorobanEvent): Promise<void> {
    const proposalId = readEventString(event, ["proposal_id", "proposalId", "id"], 1);
    const voterAddress = readEventString(
      event,
      ["voter", "voter_address", "voterAddress", "holder", "holder_address", "holderAddress"],
      2
    );
    if (!proposalId || !voterAddress) return;

    let support = true;
    const data = event.data as Record<string, unknown> | null;
    let foundSupport = false;

    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const k of ["support", "vote", "in_favor", "approve"]) {
        const val = data[k];
        if (typeof val === "boolean") {
          support = val;
          foundSupport = true;
          break;
        }
        if (typeof val === "string") {
          const lower = val.trim().toLowerCase();
          if (lower === "false" || lower === "against" || lower === "0" || lower === "no") {
            support = false;
            foundSupport = true;
            break;
          }
          if (lower === "true" || lower === "for" || lower === "1" || lower === "yes") {
            support = true;
            foundSupport = true;
            break;
          }
        }
        if (typeof val === "number") {
          support = val === 1;
          foundSupport = true;
          break;
        }
      }
    }

    if (!foundSupport) {
      const rawSupport = readEventString(event, ["support", "vote", "in_favor", "approve"]);
      const supportNum = readEventNumber(event, ["support", "vote"]);
      if (rawSupport !== null) {
        const lower = rawSupport.toLowerCase();
        support = lower === "true" || lower === "for" || lower === "1";
      } else if (supportNum !== null) {
        support = supportNum === 1;
      }
    }

    const weightNum = readEventNumber(event, [
      "weight",
      "voting_power",
      "votingPower",
      "amount",
      "balance",
    ]);
    const weight =
      readEventString(event, ["weight", "voting_power", "votingPower", "amount"]) ??
      (weightNum !== null ? weightNum.toFixed(7) : "1.0000000");

    await this.repository.recordVote({
      proposalId,
      voterAddress,
      support,
      weight,
      txHash: event.txHash ?? null,
      ledgerSequence: Number.isFinite(event.ledger) ? String(event.ledger) : null,
      votedAt: this.eventTime(event),
    });
  }

  private async recordExecution(event: DecodedSorobanEvent): Promise<void> {
    const proposalId = readEventString(event, ["proposal_id", "proposalId", "id"], 1);
    if (!proposalId) return;

    const totalKeysNum = readEventNumber(event, [
      "total_keys_migrated",
      "totalKeysMigrated",
      "keys_migrated",
      "amount",
    ]);
    const totalKeysMigrated =
      readEventString(event, ["total_keys_migrated", "totalKeysMigrated", "keys_migrated"]) ??
      (totalKeysNum !== null ? totalKeysNum.toFixed(7) : "0.0000000");

    const tokensNum = readEventNumber(event, [
      "tokens_converted",
      "tokensConverted",
      "converted_amount",
      "target_amount",
    ]);
    const tokensConverted =
      readEventString(event, ["tokens_converted", "tokensConverted", "converted_amount"]) ??
      (tokensNum !== null ? tokensNum.toFixed(7) : "0.0000000");

    const effectiveRatioNum = readEventNumber(event, [
      "effective_ratio",
      "effectiveRatio",
      "ratio",
      "conversion_ratio",
    ]);
    const effectiveRatio =
      readEventString(event, ["effective_ratio", "effectiveRatio", "ratio"]) ??
      (effectiveRatioNum !== null ? effectiveRatioNum.toFixed(7) : "1.0000000");

    const migratedHoldersNum = readEventNumber(event, [
      "migrated_holders_count",
      "migratedHoldersCount",
      "holders_count",
      "holder_count",
    ]);
    const migratedHoldersCount = migratedHoldersNum !== null ? Math.round(migratedHoldersNum) : 0;

    const executedAt = this.eventTime(event);
    const executionTxHash = event.txHash ?? null;
    const ledgerSequence = Number.isFinite(event.ledger) ? String(event.ledger) : null;

    const migrationSummary: KeyMergeMigrationSummary = {
      totalKeysMigrated,
      tokensConverted,
      effectiveRatio,
      migratedHoldersCount,
      sourceSupplyBurned:
        readEventString(event, ["source_supply_burned", "sourceSupplyBurned", "burned_supply"]) ??
        undefined,
      targetSupplyMinted:
        readEventString(event, ["target_supply_minted", "targetSupplyMinted", "minted_supply"]) ??
        undefined,
      executedAt: executedAt.toISOString(),
      executionTxHash,
      ledgerSequence,
    };

    await this.repository.recordExecution({
      proposalId,
      migrationSummary,
      executedAt,
      executionTxHash,
      ledgerSequence,
    });
  }

  private resolveDeadline(event: DecodedSorobanEvent, seconds: number): Date | null {
    const eventTime = this.eventTime(event).getTime();
    const asAbsolute = seconds > 1_000_000_000 ? seconds * 1000 : null;
    const millis = asAbsolute ?? eventTime + seconds * 1000;
    return Number.isFinite(millis) ? new Date(millis) : null;
  }

  private eventTime(event: DecodedSorobanEvent): Date {
    if (event.ledgerClosedAt) {
      const parsed = new Date(event.ledgerClosedAt);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return this.now();
  }

  private normalizeKeyId(keyId: string): string {
    if (typeof keyId !== "string" || !keyId.trim()) {
      throw new HttpError(400, "A creator key id is required.");
    }
    return keyId.trim();
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined || limit === null) return 20;
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) return 20;
    return Math.min(Math.floor(parsed), 100);
  }

  private normalizeStatus(status?: string): string {
    if (!status) return "all";
    const normalized = status.trim().toLowerCase();
    const allowed = ["all", "pending", "completed", "executed"];
    if (!allowed.includes(normalized)) {
      throw new HttpError(400, `status must be one of: ${allowed.join(", ")}`);
    }
    return normalized;
  }

  private toView(row: KeyMergeProposal): KeyMergeProposalView {
    const isCompleted = row.status === "completed" || row.status === "executed";

    const voteTally: KeyMergeVoteTally = {
      votesFor: row.votesFor ? String(row.votesFor) : "0.0000000",
      votesAgainst: row.votesAgainst ? String(row.votesAgainst) : "0.0000000",
      totalVotes: row.totalVotes ? String(row.totalVotes) : "0.0000000",
      holderCount: row.holderCount ?? 0,
      threshold: row.voteThreshold,
      thresholdReached: Boolean(row.thresholdReached),
    };

    return {
      id: row.id,
      proposalId: row.proposalId,
      keyId: row.keyId,
      contractAddress: row.contractAddress,
      sourceKeyId: row.sourceKeyId ?? null,
      targetKeyId: row.targetKeyId ?? null,
      sourceContractAddress: row.sourceContractAddress ?? null,
      targetContractAddress: row.targetContractAddress ?? null,
      conversionRatio: row.conversionRatio,
      voteThreshold: row.voteThreshold,
      status: isCompleted ? "completed" : row.status,
      voteTally,
      migrationSummary: isCompleted ? row.migrationSummary : null,
      votingDeadline: row.votingDeadline ? new Date(row.votingDeadline).toISOString() : null,
      timelockExpiry: row.timelockExpiry ? new Date(row.timelockExpiry).toISOString() : null,
      proposedAt: new Date(row.proposedAt).toISOString(),
      executedAt: row.executedAt ? new Date(row.executedAt).toISOString() : null,
      proposalTxHash: row.proposalTxHash ?? null,
      executionTxHash: row.executionTxHash ?? null,
      ledgerSequence: row.ledgerSequence ?? null,
    };
  }
}

export function createKeyMergeProposalService(
  dependencies: KeyMergeProposalServiceDependencies
): KeyMergeProposalService {
  return new KeyMergeProposalService(dependencies);
}
