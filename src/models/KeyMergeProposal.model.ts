import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type KeyMergeProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "completed"
  | "expired";

export interface KeyMergeVoteTally {
  votesFor: string;
  votesAgainst: string;
  totalVotes: string;
  holderCount: number;
  threshold: string;
  thresholdReached: boolean;
}

export interface KeyMergeMigrationSummary {
  totalKeysMigrated: string;
  tokensConverted: string;
  effectiveRatio: string;
  migratedHoldersCount: number;
  sourceSupplyBurned?: string;
  targetSupplyMinted?: string;
  executedAt: string;
  executionTxHash: string | null;
  ledgerSequence: string | null;
}

/**
 * Tracks creator key merge proposals, holder voting tallies, and execution
 * state projected from on-chain Soroban contract events.
 */
@Entity("key_merge_proposals")
@Index("idx_key_merge_proposals_key_id", ["keyId"])
@Index("idx_key_merge_proposals_proposal_id", ["proposalId"], { unique: true })
@Index("idx_key_merge_proposals_status", ["status"])
export class KeyMergeProposal {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Internal id or UUID of the creator key */
  @Column({ name: "key_id", type: "varchar", length: 128 })
  keyId!: string;

  /** On-chain proposal id, unique across the network */
  @Column({ name: "proposal_id", type: "varchar", length: 128, unique: true })
  proposalId!: string;

  /** Contract address emitting or managing the merge */
  @Column({ name: "contract_address", type: "varchar", length: 56 })
  contractAddress!: string;

  /** Key identifier of the key being merged / retired */
  @Column({ name: "source_key_id", type: "varchar", length: 128, nullable: true })
  sourceKeyId!: string | null;

  /** Key identifier of the target key receiving the merge */
  @Column({ name: "target_key_id", type: "varchar", length: 128, nullable: true })
  targetKeyId!: string | null;

  /** Contract address of the source key */
  @Column({ name: "source_contract_address", type: "varchar", length: 56, nullable: true })
  sourceContractAddress!: string | null;

  /** Contract address of the target key */
  @Column({ name: "target_contract_address", type: "varchar", length: 56, nullable: true })
  targetContractAddress!: string | null;

  /** Conversion ratio (target keys per source key, e.g. 1.5000000) */
  @Column({ name: "conversion_ratio", type: "varchar", length: 64 })
  conversionRatio!: string;

  /** Required vote threshold for passage (percentage or required quorum, e.g. 66.67) */
  @Column({ name: "vote_threshold", type: "varchar", length: 64 })
  voteThreshold!: string;

  /** Current lifecycle status */
  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: KeyMergeProposalStatus;

  /** Total voting power in favor */
  @Column({ name: "votes_for", type: "decimal", precision: 30, scale: 7, default: 0 })
  votesFor!: string;

  /** Total voting power against */
  @Column({ name: "votes_against", type: "decimal", precision: 30, scale: 7, default: 0 })
  votesAgainst!: string;

  /** Total voting power cast */
  @Column({ name: "total_votes", type: "decimal", precision: 30, scale: 7, default: 0 })
  totalVotes!: string;

  /** Number of distinct holders who voted */
  @Column({ name: "holder_count", type: "integer", default: 0 })
  holderCount!: number;

  /** Whether the vote threshold has been reached */
  @Column({ name: "threshold_reached", type: "boolean", default: false })
  thresholdReached!: boolean;

  /** Deadline when holder voting concludes */
  @Column({ name: "voting_deadline", type: "timestamptz", nullable: true })
  votingDeadline!: Date | null;

  /** Timelock unlock time if applicable */
  @Column({ name: "timelock_expiry", type: "timestamptz", nullable: true })
  timelockExpiry!: Date | null;

  /** Migration summary populated when MergeExecuted event fires */
  @Column({ name: "migration_summary", type: "jsonb", nullable: true })
  migrationSummary!: KeyMergeMigrationSummary | null;

  /** When proposed on chain */
  @Column({ name: "proposed_at", type: "timestamptz" })
  proposedAt!: Date;

  /** When executed on chain */
  @Column({ name: "executed_at", type: "timestamptz", nullable: true })
  executedAt!: Date | null;

  @Column({ name: "proposal_tx_hash", type: "varchar", length: 64, nullable: true })
  proposalTxHash!: string | null;

  @Column({ name: "execution_tx_hash", type: "varchar", length: 64, nullable: true })
  executionTxHash!: string | null;

  @Column({ name: "ledger_sequence", type: "bigint", nullable: true })
  ledgerSequence!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
