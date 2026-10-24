import crypto from "node:crypto";
import request from "supertest";
import express, { type Express } from "express";

import { createKeysRouter } from "../src/routes/keys.routes";
import { createCreatorKeyService } from "../src/services/creator-key.service";
import {
  createKeyMergeProposalService,
  type KeyMergeCursor,
  type KeyMergeExecutionInput,
  type KeyMergeProposalInput,
  type KeyMergeProposalRepositoryContract,
  type KeyMergeVoteInput,
} from "../src/services/key-merge-proposal.service";
import { encodeCursor } from "../src/utils/cursor-pagination.utils";
import { AdminRole, KYCStatus, UserType } from "../src/types/enums";
import type { AuthenticatedRequest } from "../src/types/auth";
import type { CreatorKey } from "../src/models/CreatorKey.model";
import type { KeyMergeProposal } from "../src/models/KeyMergeProposal.model";
import type { KeyMergeVote } from "../src/models/KeyMergeVote.model";
import type { DecodedSorobanEvent } from "../src/types/soroban.types";
import type { AuthService } from "../src/services/auth.service";

const CREATOR_WALLET = "GCREATORWALLET0000000000000000000000000000000000000000AA";
const OTHER_CREATOR = "GOTHERCREATOR0000000000000000000000000000000000000000AA";
const ADMIN_WALLET = "GADMINWALLET0000000000000000000000000000000000000000AA";
const INVESTOR_WALLET = "GINVESTORWALLET0000000000000000000000000000000000000AA";

function makeEvent(
  overrides: Partial<DecodedSorobanEvent> & { topic: string }
): DecodedSorobanEvent {
  return {
    id: `evt-${crypto.randomUUID()}`,
    contractId: "CKETMERGE",
    ledger: 1000,
    ledgerClosedAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
    txHash: "a".repeat(64),
    topics: [],
    data: null,
    inSuccessfulContractCall: true,
    ...overrides,
  };
}

function makeKey(overrides: Partial<CreatorKey> = {}): CreatorKey {
  return {
    id: "key-1",
    creatorId: CREATOR_WALLET,
    creatorWallet: CREATOR_WALLET,
    contractAddress: "CKEY1",
    maxBuyPerTx: "500.0000000",
    maxBuyPerDay: "2000.0000000",
    currentSupply: "1000.0000000",
    curveType: "constant_product",
    configVersion: 1,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as CreatorKey;
}

function makeProposal(overrides: Partial<KeyMergeProposal> = {}): KeyMergeProposal {
  return {
    id: "prop-uuid-1",
    keyId: "key-1",
    proposalId: "merge-prop-1",
    contractAddress: "CKETMERGE",
    sourceKeyId: "key-source",
    targetKeyId: "key-1",
    sourceContractAddress: "CSOURCE",
    targetContractAddress: "CTARGET",
    conversionRatio: "1.5000000",
    voteThreshold: "66.67",
    status: "pending",
    votesFor: "0.0000000",
    votesAgainst: "0.0000000",
    totalVotes: "0.0000000",
    holderCount: 0,
    thresholdReached: false,
    votingDeadline: new Date("2026-03-01T00:00:00.000Z"),
    timelockExpiry: new Date("2026-03-01T00:00:00.000Z"),
    migrationSummary: null,
    proposedAt: new Date("2026-02-01T00:00:00.000Z"),
    executedAt: null,
    proposalTxHash: "p".repeat(64),
    executionTxHash: null,
    ledgerSequence: "1000",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  } as KeyMergeProposal;
}

function fakeMergeProposalRepository(
  initialProposals: KeyMergeProposal[] = [],
  initialVotes: KeyMergeVote[] = []
): KeyMergeProposalRepositoryContract {
  const proposals: KeyMergeProposal[] = [...initialProposals];
  const votes: KeyMergeVote[] = [...initialVotes];

  return {
    async findByKeyId(
      keyId: string,
      options: { status?: string; limit?: number; cursor?: KeyMergeCursor | null } = {}
    ) {
      const limit = options.limit ?? 20;
      let filtered = proposals.filter(
        (p) => p.keyId === keyId || p.sourceKeyId === keyId || p.targetKeyId === keyId
      );

      if (options.status === "pending") {
        filtered = filtered.filter((p) => p.status === "pending");
      } else if (options.status === "completed" || options.status === "executed") {
        filtered = filtered.filter((p) => p.status === "completed" || p.status === "executed");
      }

      filtered.sort((a, b) => {
        const timeDiff = b.proposedAt.getTime() - a.proposedAt.getTime();
        return timeDiff !== 0 ? timeDiff : b.id.localeCompare(a.id);
      });

      const total = filtered.length;

      if (options.cursor) {
        filtered = filtered.filter((p) => {
          const t = p.proposedAt.getTime();
          const ct = options.cursor!.createdAt.getTime();
          return t < ct || (t === ct && p.id < options.cursor!.id);
        });
      }

      const hasMore = filtered.length > limit;
      const items = hasMore ? filtered.slice(0, limit) : filtered;

      return { items, hasMore, total };
    },

    async findByProposalId(proposalId: string) {
      return proposals.find((p) => p.proposalId === proposalId) ?? null;
    },

    async findById(id: string) {
      return proposals.find((p) => p.id === id) ?? null;
    },

    async recordProposal(input: KeyMergeProposalInput) {
      const existing = proposals.find((p) => p.proposalId === input.proposalId);
      if (existing) return existing;

      const created: KeyMergeProposal = {
        id: `prop-uuid-${proposals.length + 1}`,
        keyId: input.keyId,
        proposalId: input.proposalId,
        contractAddress: input.contractAddress,
        sourceKeyId: input.sourceKeyId ?? null,
        targetKeyId: input.targetKeyId ?? null,
        sourceContractAddress: input.sourceContractAddress ?? null,
        targetContractAddress: input.targetContractAddress ?? null,
        conversionRatio: input.conversionRatio,
        voteThreshold: input.voteThreshold,
        status: "pending",
        votesFor: "0.0000000",
        votesAgainst: "0.0000000",
        totalVotes: "0.0000000",
        holderCount: 0,
        thresholdReached: false,
        votingDeadline: input.votingDeadline ?? null,
        timelockExpiry: input.timelockExpiry ?? null,
        migrationSummary: null,
        proposedAt: input.proposedAt,
        executedAt: null,
        proposalTxHash: input.proposalTxHash ?? null,
        executionTxHash: null,
        ledgerSequence: input.ledgerSequence ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      proposals.push(created);
      return created;
    },

    async recordVote(input: KeyMergeVoteInput) {
      let vote = votes.find(
        (v) => v.proposalId === input.proposalId && v.voterAddress === input.voterAddress
      );

      if (vote) {
        vote.support = input.support;
        vote.weight = input.weight;
        vote.votedAt = input.votedAt;
      } else {
        vote = {
          id: `vote-uuid-${votes.length + 1}`,
          proposalId: input.proposalId,
          voterAddress: input.voterAddress,
          support: input.support,
          weight: input.weight,
          txHash: input.txHash ?? null,
          ledgerSequence: input.ledgerSequence ?? null,
          votedAt: input.votedAt,
          createdAt: new Date(),
        };
        votes.push(vote);
      }

      const proposal = proposals.find((p) => p.proposalId === input.proposalId) ?? null;
      if (proposal) {
        const propVotes = votes.filter((v) => v.proposalId === input.proposalId);
        let sumFor = 0;
        let sumAgainst = 0;
        for (const v of propVotes) {
          const w = Number(v.weight) || 0;
          if (v.support) sumFor += w;
          else sumAgainst += w;
        }
        const total = sumFor + sumAgainst;
        proposal.votesFor = sumFor.toFixed(7);
        proposal.votesAgainst = sumAgainst.toFixed(7);
        proposal.totalVotes = total.toFixed(7);
        proposal.holderCount = propVotes.length;

        const thresholdNum = Number(proposal.voteThreshold) || 0;
        proposal.thresholdReached =
          thresholdNum > 1
            ? total > 0 && (sumFor / total) * 100 >= thresholdNum
            : total > 0 && sumFor / total >= thresholdNum;
      }

      return { proposal, vote };
    },

    async recordExecution(input: KeyMergeExecutionInput) {
      const proposal = proposals.find((p) => p.proposalId === input.proposalId);
      if (!proposal) return null;

      proposal.status = "completed";
      proposal.migrationSummary = input.migrationSummary;
      proposal.executedAt = input.executedAt;
      proposal.executionTxHash = input.executionTxHash ?? null;
      proposal.ledgerSequence = input.ledgerSequence ?? proposal.ledgerSequence;

      return proposal;
    },

    async findVotesByProposalId(proposalId: string) {
      return votes.filter((v) => v.proposalId === proposalId);
    },
  };
}

function fakeAuthService(users: Record<string, AuthenticatedRequest["user"]>): AuthService {
  return {
    async getCurrentUser(token: string) {
      const user = users[token];
      if (!user) {
        const error = new Error("Invalid token") as Error & { statusCode?: number };
        error.statusCode = 401;
        throw error;
      }
      return user;
    },
  } as unknown as AuthService;
}

function makeUser(
  wallet: string,
  userType: UserType | AdminRole = UserType.INVESTOR
): AuthenticatedRequest["user"] {
  return {
    id: wallet,
    stellarAddress: wallet,
    email: null,
    userType: userType as UserType,
    kycStatus: KYCStatus.APPROVED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildTestApp(deps: {
  proposals?: KeyMergeProposal[];
  votes?: KeyMergeVote[];
  users?: Record<string, AuthenticatedRequest["user"]>;
  keys?: CreatorKey[];
}): { app: Express; repo: KeyMergeProposalRepositoryContract } {
  const app = express();
  app.use(express.json());

  const repo = fakeMergeProposalRepository(deps.proposals ?? [], deps.votes ?? []);
  const keyMergeProposalService = createKeyMergeProposalService({
    keyMergeProposalRepository: repo,
    now: () => new Date("2026-02-15T00:00:00.000Z"),
  });

  const creatorKeyService = createCreatorKeyService({
    creatorKeyRepository: {
      async findById(id: string) {
        return (deps.keys ?? [makeKey()]).find((k) => k.id === id) ?? null;
      },
      async findByContractAddress(addr: string) {
        return (deps.keys ?? [makeKey()]).find((k) => k.contractAddress === addr) ?? null;
      },
      async applyConfigUpdate() {
        return null;
      },
    },
  });

  const authService = fakeAuthService(deps.users ?? {});

  app.use(
    "/api/v1/keys",
    createKeysRouter({
      creatorKeyService,
      keyMergeProposalService,
      authService,
    })
  );

  app.use(
    (
      err: { statusCode?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.statusCode ?? 500).json({
        success: false,
        error: { message: err.message },
      });
    }
  );

  return { app, repo };
}

describe("Key Merge Proposals Service & On-Chain Projections", () => {
  it("subscribes to merge proposal, vote, and execution event topics", () => {
    const repo = fakeMergeProposalRepository();
    const service = createKeyMergeProposalService({ keyMergeProposalRepository: repo });
    const topics = service.topics();

    expect(topics).toContain("merge_proposed");
    expect(topics).toContain("merge_voted");
    expect(topics).toContain("merge_executed");
  });

  it("syncs a new merge proposal from a MergeProposed contract event with conversion ratio and threshold", async () => {
    const repo = fakeMergeProposalRepository();
    const service = createKeyMergeProposalService({ keyMergeProposalRepository: repo });

    const event = makeEvent({
      topic: "merge_proposed",
      topics: ["merge_proposed", "key-1", "prop-100"],
      data: {
        key_id: "key-1",
        proposal_id: "prop-100",
        source_key_id: "key-retired",
        target_key_id: "key-1",
        conversion_ratio: "1.7500000",
        vote_threshold: "66.67",
        voting_deadline: 1772323200, // future timestamp
      },
    });

    await service.handle(event);

    const saved = await repo.findByProposalId("prop-100");
    expect(saved).not.toBeNull();
    expect(saved!.keyId).toBe("key-1");
    expect(saved!.proposalId).toBe("prop-100");
    expect(saved!.conversionRatio).toBe("1.7500000");
    expect(saved!.voteThreshold).toBe("66.67");
    expect(saved!.status).toBe("pending");
  });

  it("syncs holder vote tally from MergeVoted events and updates thresholdReached", async () => {
    const repo = fakeMergeProposalRepository([
      makeProposal({ proposalId: "prop-vote-1", voteThreshold: "60.00" }),
    ]);
    const service = createKeyMergeProposalService({ keyMergeProposalRepository: repo });

    // Voter 1 casts 60 votes in favor
    await service.handle(
      makeEvent({
        topic: "merge_voted",
        topics: ["merge_voted", "prop-vote-1", "GVOTER1"],
        data: {
          proposal_id: "prop-vote-1",
          voter: "GVOTER1",
          support: true,
          weight: "60.0000000",
        },
      })
    );

    let prop = await repo.findByProposalId("prop-vote-1");
    expect(prop!.votesFor).toBe("60.0000000");
    expect(prop!.votesAgainst).toBe("0.0000000");
    expect(prop!.totalVotes).toBe("60.0000000");
    expect(prop!.holderCount).toBe(1);
    expect(prop!.thresholdReached).toBe(true);

    // Voter 2 casts 40 votes against
    await service.handle(
      makeEvent({
        topic: "merge_voted",
        topics: ["merge_voted", "prop-vote-1", "GVOTER2"],
        data: {
          proposal_id: "prop-vote-1",
          voter: "GVOTER2",
          support: false,
          weight: "40.0000000",
        },
      })
    );

    prop = await repo.findByProposalId("prop-vote-1");
    expect(prop!.votesFor).toBe("60.0000000");
    expect(prop!.votesAgainst).toBe("40.0000000");
    expect(prop!.totalVotes).toBe("100.0000000");
    expect(prop!.holderCount).toBe(2);
    // 60 / 100 = 60%, threshold is 60.00%, so threshold is reached
    expect(prop!.thresholdReached).toBe(true);

    // Voter 3 casts 20 votes against -> 60 / 120 = 50% < 60%, threshold no longer reached
    await service.handle(
      makeEvent({
        topic: "merge_voted",
        topics: ["merge_voted", "prop-vote-1", "GVOTER3"],
        data: {
          proposal_id: "prop-vote-1",
          voter: "GVOTER3",
          support: false,
          weight: "20.0000000",
        },
      })
    );

    prop = await repo.findByProposalId("prop-vote-1");
    expect(prop!.votesFor).toBe("60.0000000");
    expect(prop!.votesAgainst).toBe("60.0000000");
    expect(prop!.totalVotes).toBe("120.0000000");
    expect(prop!.holderCount).toBe(3);
    expect(prop!.thresholdReached).toBe(false);
  });

  it("updates execution status and records migration summary from MergeExecuted event", async () => {
    const repo = fakeMergeProposalRepository([makeProposal({ proposalId: "prop-exec-1" })]);
    const service = createKeyMergeProposalService({ keyMergeProposalRepository: repo });

    const executedEvent = makeEvent({
      topic: "merge_executed",
      topics: ["merge_executed", "prop-exec-1"],
      data: {
        proposal_id: "prop-exec-1",
        total_keys_migrated: "50000.0000000",
        tokens_converted: "75000.0000000",
        effective_ratio: "1.5000000",
        migrated_holders_count: 24,
        source_supply_burned: "50000.0000000",
        target_supply_minted: "75000.0000000",
      },
      txHash: "e".repeat(64),
      ledger: 1500,
    });

    await service.handle(executedEvent);

    const prop = await repo.findByProposalId("prop-exec-1");
    expect(prop!.status).toBe("completed");
    expect(prop!.migrationSummary).not.toBeNull();
    expect(prop!.migrationSummary!.totalKeysMigrated).toBe("50000.0000000");
    expect(prop!.migrationSummary!.tokensConverted).toBe("75000.0000000");
    expect(prop!.migrationSummary!.effectiveRatio).toBe("1.5000000");
    expect(prop!.migrationSummary!.migratedHoldersCount).toBe(24);
    expect(prop!.migrationSummary!.executionTxHash).toBe("e".repeat(64));
    expect(prop!.migrationSummary!.ledgerSequence).toBe("1500");
  });
});

describe("GET /api/v1/keys/:id/merge-proposals — Access Control & Role Enforcement", () => {
  const proposals: KeyMergeProposal[] = [
    makeProposal({
      id: "p-1",
      proposalId: "prop-1",
      status: "pending",
      conversionRatio: "1.5000000",
      voteThreshold: "66.67",
    }),
    makeProposal({
      id: "p-2",
      proposalId: "prop-2",
      status: "completed",
      conversionRatio: "2.0000000",
      voteThreshold: "50.00",
      migrationSummary: {
        totalKeysMigrated: "1000.0000000",
        tokensConverted: "2000.0000000",
        effectiveRatio: "2.0000000",
        migratedHoldersCount: 5,
        executedAt: "2026-02-10T00:00:00.000Z",
        executionTxHash: "e".repeat(64),
        ledgerSequence: "800",
      },
    }),
  ];

  it("rejects unauthenticated requests with 401", async () => {
    const { app } = buildTestApp({ proposals });
    const response = await request(app).get("/api/v1/keys/key-1/merge-proposals");
    expect(response.status).toBe(401);
  });

  it("rejects non-creator, non-admin users with 403", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "investor-token": makeUser(INVESTOR_WALLET, UserType.INVESTOR) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals")
      .set("Authorization", "Bearer investor-token");

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/Admin or creator access required/);
  });

  it("rejects creators of other keys who do not own this key with 403", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "other-creator-token": makeUser(OTHER_CREATOR, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals")
      .set("Authorization", "Bearer other-creator-token");

    expect(response.status).toBe(403);
  });

  it("allows the key creator access to merge proposals (200 OK)", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "creator-token": makeUser(CREATOR_WALLET, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals")
      .set("Authorization", "Bearer creator-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.pending).toHaveLength(1);
    expect(response.body.data.completed).toHaveLength(1);
    expect(response.body.data.pending[0].conversionRatio).toBe("1.5000000");
    expect(response.body.data.pending[0].voteThreshold).toBe("66.67");
    expect(response.body.data.completed[0].migrationSummary).toEqual(
      expect.objectContaining({
        totalKeysMigrated: "1000.0000000",
        tokensConverted: "2000.0000000",
        effectiveRatio: "2.0000000",
        migratedHoldersCount: 5,
      })
    );
  });

  it("allows administrators access to merge proposals (200 OK)", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "admin-token": makeUser(ADMIN_WALLET, AdminRole.ADMIN) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals")
      .set("Authorization", "Bearer admin-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.total).toBe(2);
  });

  it("filters proposals by status=pending", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "creator-token": makeUser(CREATOR_WALLET, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals?status=pending")
      .set("Authorization", "Bearer creator-token");

    expect(response.status).toBe(200);
    expect(response.body.data.pending).toHaveLength(1);
    expect(response.body.data.completed).toHaveLength(0);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].status).toBe("pending");
  });

  it("filters proposals by status=completed", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "creator-token": makeUser(CREATOR_WALLET, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals?status=completed")
      .set("Authorization", "Bearer creator-token");

    expect(response.status).toBe(200);
    expect(response.body.data.pending).toHaveLength(0);
    expect(response.body.data.completed).toHaveLength(1);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].status).toBe("completed");
  });

  it("rejects an invalid status filter with 400", async () => {
    const { app } = buildTestApp({
      proposals,
      users: { "creator-token": makeUser(CREATOR_WALLET, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals?status=invalid_status")
      .set("Authorization", "Bearer creator-token");

    expect(response.status).toBe(400);
  });
});

describe("Pagination cursor on merge history", () => {
  const p1 = makeProposal({
    id: "prop-id-1",
    proposalId: "prop-num-1",
    status: "completed",
    proposedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const p2 = makeProposal({
    id: "prop-id-2",
    proposalId: "prop-num-2",
    status: "completed",
    proposedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  const p3 = makeProposal({
    id: "prop-id-3",
    proposalId: "prop-num-3",
    status: "completed",
    proposedAt: new Date("2026-01-03T00:00:00.000Z"),
  });

  const allProposals = [p1, p2, p3]; // sorted DESC: p3, p2, p1

  it("returns paginated page with nextCursor when items exceed limit", async () => {
    const { app } = buildTestApp({
      proposals: allProposals,
      users: { "admin-token": makeUser(ADMIN_WALLET, AdminRole.ADMIN) },
    });

    const page1 = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals?limit=2")
      .set("Authorization", "Bearer admin-token");

    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.meta.hasMore).toBe(true);
    expect(page1.body.meta.nextCursor).not.toBeNull();

    // Verify nextCursor decodes to the second item (p2)
    const nextCursor = page1.body.meta.nextCursor;
    expect(nextCursor).toBe(encodeCursor(p2.proposedAt, p2.id));

    // Request second page with nextCursor
    const page2 = await request(app)
      .get(`/api/v1/keys/key-1/merge-proposals?limit=2&cursor=${encodeURIComponent(nextCursor)}`)
      .set("Authorization", "Bearer admin-token");

    expect(page2.status).toBe(200);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.items[0].id).toBe(p1.id);
    expect(page2.body.meta.hasMore).toBe(false);
    expect(page2.body.meta.nextCursor).toBeNull();
  });

  it("rejects malformed pagination cursor with 400", async () => {
    const { app } = buildTestApp({
      proposals: allProposals,
      users: { "admin-token": makeUser(ADMIN_WALLET, AdminRole.ADMIN) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals?cursor=malformed_cursor")
      .set("Authorization", "Bearer admin-token");

    expect(response.status).toBe(400);
  });
});

describe("GET /api/v1/keys/:id/merge-proposals/:proposalId", () => {
  const proposal = makeProposal({
    id: "prop-detail-1",
    proposalId: "prop-det-1",
    conversionRatio: "1.2500000",
    voteThreshold: "75.00",
    votesFor: "7500.0000000",
    votesAgainst: "2500.0000000",
    totalVotes: "10000.0000000",
    holderCount: 8,
    thresholdReached: true,
  });

  it("returns single proposal details with vote tally to creator", async () => {
    const { app } = buildTestApp({
      proposals: [proposal],
      users: { "creator-token": makeUser(CREATOR_WALLET, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals/prop-det-1")
      .set("Authorization", "Bearer creator-token");

    expect(response.status).toBe(200);
    expect(response.body.data.proposalId).toBe("prop-det-1");
    expect(response.body.data.conversionRatio).toBe("1.2500000");
    expect(response.body.data.voteThreshold).toBe("75.00");
    expect(response.body.data.voteTally).toEqual({
      votesFor: "7500.0000000",
      votesAgainst: "2500.0000000",
      totalVotes: "10000.0000000",
      holderCount: 8,
      threshold: "75.00",
      thresholdReached: true,
    });
  });

  it("returns 404 when proposal does not exist", async () => {
    const { app } = buildTestApp({
      proposals: [],
      users: { "creator-token": makeUser(CREATOR_WALLET, UserType.SELLER) },
    });

    const response = await request(app)
      .get("/api/v1/keys/key-1/merge-proposals/non-existent-prop")
      .set("Authorization", "Bearer creator-token");

    expect(response.status).toBe(404);
  });
});
