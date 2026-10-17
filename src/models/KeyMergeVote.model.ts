import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Tracks individual holder votes on a key merge proposal.
 */
@Entity("key_merge_votes")
@Index("idx_key_merge_votes_proposal_id", ["proposalId"])
@Index("idx_key_merge_votes_voter_proposal", ["proposalId", "voterAddress"], { unique: true })
export class KeyMergeVote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** On-chain proposal id */
  @Column({ name: "proposal_id", type: "varchar", length: 128 })
  proposalId!: string;

  /** Stellar address of the voting holder */
  @Column({ name: "voter_address", type: "varchar", length: 56 })
  voterAddress!: string;

  /** True if voting in favor, false if against */
  @Column({ type: "boolean", default: true })
  support!: boolean;

  /** Voting power / token weight of the vote */
  @Column({ type: "decimal", precision: 30, scale: 7, default: 0 })
  weight!: string;

  @Column({ name: "tx_hash", type: "varchar", length: 64, nullable: true })
  txHash!: string | null;

  @Column({ name: "ledger_sequence", type: "bigint", nullable: true })
  ledgerSequence!: string | null;

  @Column({ name: "voted_at", type: "timestamptz" })
  votedAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
