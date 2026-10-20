import { DataSource } from "typeorm";
import { TtlCache } from "../lib/ttl-cache";

export interface ExtensionProposal {
  id: string;
  invoiceId: string;
  proposedBy: string;
  newDeadline: number;
  status: string;
  votesFor: number;
  votesAgainst: number;
  quorumBps: number;
  eta: number;
  createdAt: number;
}

export interface ExtensionVote {
  wallet: string;
  vote: "for" | "against";
  weight: string;
  votedAt: number;
}

/**
 * #681 — Invoice extension proposal indexer and vote tracking REST API.
 * Indexes ExtensionProposed, ExtensionVoteCast, and ExtensionExecuted events.
 */
export class ExtensionProposalService {
  private cache: TtlCache;

  constructor(private readonly dataSource: DataSource) {
    this.cache = new TtlCache({ ttlSeconds: 30, namespace: "extension-proposal" });
  }

  async getActiveProposal(invoiceId: string): Promise<ExtensionProposal | null> {
    const cacheKey = `active:${invoiceId}`;
    const cached = this.cache.get<ExtensionProposal>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT id, invoice_id, proposed_by, new_deadline, status,
              votes_for, votes_against, quorum_bps, eta, created_at
       FROM extension_proposals
       WHERE invoice_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [invoiceId],
    );

    if (!rows.length) return null;

    const proposal = this.mapProposal(rows[0]);
    this.cache.set(cacheKey, proposal);
    return proposal;
  }

  async getWalletVote(invoiceId: string, wallet: string): Promise<ExtensionVote | null> {
    const cacheKey = `vote:${invoiceId}:${wallet}`;
    const cached = this.cache.get<ExtensionVote>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT wallet, vote, weight, voted_at
       FROM extension_votes WHERE invoice_id = $1 AND wallet = $2`,
      [invoiceId, wallet],
    );

    if (!rows.length) return null;

    const vote = {
      wallet: rows[0].wallet,
      vote: rows[0].vote as "for" | "against",
      weight: rows[0].weight,
      votedAt: rows[0].voted_at,
    };

    this.cache.set(cacheKey, vote);
    return vote;
  }

  async getProposalHistory(invoiceId: string): Promise<ExtensionProposal[]> {
    const cacheKey = `history:${invoiceId}`;
    const cached = this.cache.get<ExtensionProposal[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT id, invoice_id, proposed_by, new_deadline, status,
              votes_for, votes_against, quorum_bps, eta, created_at
       FROM extension_proposals
       WHERE invoice_id = $1 AND status IN ('completed', 'rejected')
       ORDER BY created_at DESC`,
      [invoiceId],
    );

    const proposals = rows.map((r: any) => this.mapProposal(r));
    this.cache.set(cacheKey, proposals);
    return proposals;
  }

  private mapProposal(r: any): ExtensionProposal {
    return {
      id: r.id,
      invoiceId: r.invoice_id,
      proposedBy: r.proposed_by,
      newDeadline: r.new_deadline,
      status: r.status,
      votesFor: r.votes_for,
      votesAgainst: r.votes_against,
      quorumBps: r.quorum_bps,
      eta: r.eta,
      createdAt: r.created_at,
    };
  }

  /** Invalidate cache for an invoice when an extension event occurs. */
  invalidate(invoiceId: string): void {
    this.cache.delete(`active:${invoiceId}`);
    this.cache.delete(`history:${invoiceId}`);
    this.cache.clearNamespace("extension-proposal");
  }
}
