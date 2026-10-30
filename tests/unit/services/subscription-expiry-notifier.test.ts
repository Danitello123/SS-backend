import Decimal from "decimal.js";
import {
  SubscriptionExpiryNotifierService,
  createSubscriptionExpiryNotifierService,
  InMemorySubscriptionDedupeStore,
  type SubscriptionCandidate,
  type SubscriptionNotificationSink,
} from "../../../src/services/subscription-expiry-notifier.service";
import {
  runSubscriptionExpiryJob,
  scheduleSubscriptionExpiryJob,
} from "../../../src/workers/subscription-expiry.worker";
import { NotificationType } from "../../../src/types/enums";
import { LEDGERS_PER_DAY } from "../../../src/services/subscription-status.service";

interface SentNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
}

function createMockNotificationSink(): {
  sink: SubscriptionNotificationSink;
  sent: SentNotification[];
  dedupeMap: Map<string, SentNotification>;
} {
  const sent: SentNotification[] = [];
  const dedupeMap = new Map<string, SentNotification>();

  const sink: SubscriptionNotificationSink = {
    async createNotification(userId, type, title, message, data, dedupeKey) {
      if (dedupeKey && dedupeMap.has(dedupeKey)) {
        throw new Error(`duplicate key value violates unique constraint "uq_notifications_dedupe_key"`);
      }
      const record: SentNotification = {
        userId,
        type,
        title,
        message,
        data,
        dedupeKey: dedupeKey || null,
      };
      sent.push(record);
      if (dedupeKey) {
        dedupeMap.set(dedupeKey, record);
      }
      return { id: `notif-${sent.length}`, ...record };
    },
    async findByDedupeKey(dedupeKey) {
      return dedupeMap.get(dedupeKey) ?? null;
    },
  };

  return { sink, sent, dedupeMap };
}

describe("Subscription Expiry Notification Service", () => {
  const FIXED_NOW = new Date("2026-10-17T12:00:00.000Z");
  const WALLET_A = "GDATAA000000000000000000000000000000000000000000000000000001";
  const WALLET_B = "GDATAB000000000000000000000000000000000000000000000000000002";
  const KEY_ID = "CKEY0000000000000000000000000000000000000000000000000000000001";

  // Acceptance Criteria 1: 7-day warning notification dispatched correctly
  it("dispatches 7-day warning notification correctly when subscription expires within 7 days", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    // 5 days remaining (<= 7 days, > 24 hours)
    const expiryDate = new Date("2026-10-22T12:00:00.000Z");

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Creator Pro Pass",
      expiryDate,
      minHolding: "100",
      currentBalance: "25", // does not meet minimum holding (25 < 100)
    };

    const result = await service.checkSubscription(candidate);

    expect(result.status).toBe("notified");
    expect(result.window).toBe("7d");
    expect(sent).toHaveLength(1);

    const notification = sent[0];
    expect(notification.userId).toBe(WALLET_A);
    expect(notification.type).toBe(NotificationType.SUBSCRIPTION);
    expect(notification.title).toBe("Subscription Expiring Soon: Creator Pro Pass");
    expect(notification.message).toContain("Creator Pro Pass");
    expect(notification.message).toContain(expiryDate.toISOString());
    expect(notification.message).toContain("100");
    expect(notification.dedupeKey).toBe(`sub_expiry:${WALLET_A}:${KEY_ID}:2026-10-22:7d`);
  });

  // Acceptance Criteria 2: 24-hour warning notification dispatched correctly
  it("dispatches 24-hour warning notification correctly when subscription expires within 24 hours", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    // 12 hours remaining (<= 24 hours)
    const expiryDate = new Date("2026-10-18T00:00:00.000Z");

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "VIP Pass",
      expiryDate,
      minHolding: "50",
      currentBalance: "10", // does not meet minimum holding (10 < 50)
    };

    const result = await service.checkSubscription(candidate);

    expect(result.status).toBe("notified");
    expect(result.window).toBe("24h");
    expect(sent).toHaveLength(1);

    const notification = sent[0];
    expect(notification.title).toBe("Urgent: Subscription Expiring in 24 Hours - VIP Pass");
    expect(notification.message).toContain("Urgent");
    expect(notification.message).toContain("VIP Pass");
    expect(notification.message).toContain(expiryDate.toISOString());
    expect(notification.message).toContain("50");
    expect(notification.dedupeKey).toBe(`sub_expiry:${WALLET_A}:${KEY_ID}:2026-10-18:24h`);
  });

  // Acceptance Criteria 3: Notification skipped if wallet already meets minimum holding
  it("skips notification if wallet already meets minimum holding", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    const expiryDate = new Date("2026-10-20T12:00:00.000Z"); // 3 days remaining

    // Case A: currentBalance equals minHolding
    const candidateEqual: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Gold Key",
      expiryDate,
      minHolding: "100",
      currentBalance: "100",
    };

    const resultEqual = await service.checkSubscription(candidateEqual);
    expect(resultEqual.status).toBe("skipped_meets_minimum_holding");
    expect(resultEqual.reason).toBe("Wallet already meets minimum holding");
    expect(sent).toHaveLength(0);

    // Case B: currentBalance exceeds minHolding
    const candidateExceed: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Gold Key",
      expiryDate,
      minHolding: "100",
      currentBalance: "150",
    };

    const resultExceed = await service.checkSubscription(candidateExceed);
    expect(resultExceed.status).toBe("skipped_meets_minimum_holding");
    expect(sent).toHaveLength(0);

    // Case C: explicitly marked as toppedUp / meetsMinimumHolding
    const candidateToppedUp: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Gold Key",
      expiryDate,
      minHolding: "100",
      currentBalance: "20",
      hasToppedUp: true,
    };

    const resultToppedUp = await service.checkSubscription(candidateToppedUp);
    expect(resultToppedUp.status).toBe("skipped_meets_minimum_holding");
    expect(sent).toHaveLength(0);
  });

  // Acceptance Criteria 4: Notification content includes key name, expiry, and minimum holding
  it("includes key name, expiry date, and minimum holding required in both message text and data payload", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    const expiryDate = new Date("2026-10-21T15:30:00.000Z");
    const keyName = "Exclusive Music Pass";
    const minHolding = "250";

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName,
      expiryDate,
      minHolding,
      currentBalance: "50",
    };

    await service.checkSubscription(candidate);

    expect(sent).toHaveLength(1);
    const notif = sent[0];

    // Notification title & message contain key name
    expect(notif.title).toContain(keyName);
    expect(notif.message).toContain(keyName);

    // Notification message contains formatted expiry date
    expect(notif.message).toContain(expiryDate.toISOString());

    // Notification message contains minimum holding
    expect(notif.message).toContain(minHolding);

    // Notification data contains structured properties
    expect(notif.data).toMatchObject({
      keyId: KEY_ID,
      keyName,
      expiryDate: expiryDate.toISOString(),
      expiry: expiryDate.toISOString(),
      minHolding,
      minimumHolding: minHolding,
      currentBalance: "50",
      window: "7d",
    });
  });

  // Acceptance Criteria 5: Duplicate notifications prevented for same expiry cycle
  it("prevents duplicate notifications for the same expiry cycle and window", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    const expiryDate = new Date("2026-10-21T12:00:00.000Z"); // 4 days remaining (7d window)

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Alpha Pass",
      expiryDate,
      minHolding: "100",
      currentBalance: "10",
    };

    // First run dispatches notification
    const firstRun = await service.checkSubscription(candidate);
    expect(firstRun.status).toBe("notified");
    expect(sent).toHaveLength(1);

    // Second run with the same cycle & window is skipped as a duplicate
    const secondRun = await service.checkSubscription(candidate);
    expect(secondRun.status).toBe("skipped_duplicate");
    expect(secondRun.reason).toContain("Duplicate notification prevented");
    expect(sent).toHaveLength(1); // still only 1 notification
  });

  it("sends second notification 24 hours before expiry after 7-day notification was already sent", async () => {
    const { sink, sent } = createMockNotificationSink();

    // Day 1: 5 days before expiry -> 7-day notification is sent
    const day1Now = new Date("2026-10-17T12:00:00.000Z");
    const expiryDate = new Date("2026-10-22T12:00:00.000Z");

    const serviceDay1 = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => day1Now,
    });

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Alpha Pass",
      expiryDate,
      minHolding: "100",
      currentBalance: "20",
      cycleId: "cycle-2026-10-22",
    };

    const res1 = await serviceDay1.checkSubscription(candidate);
    expect(res1.status).toBe("notified");
    expect(res1.window).toBe("7d");
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Subscription Expiring Soon: Alpha Pass");

    // Day 5: 12 hours before expiry -> 24-hour notification is sent!
    const day5Now = new Date("2026-10-22T00:00:00.000Z");
    const serviceDay5 = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => day5Now,
    });

    const res2 = await serviceDay5.checkSubscription(candidate);
    expect(res2.status).toBe("notified");
    expect(res2.window).toBe("24h");
    expect(sent).toHaveLength(2);
    expect(sent[1].title).toBe("Urgent: Subscription Expiring in 24 Hours - Alpha Pass");
    expect(sent[1].dedupeKey).toBe(`sub_expiry:${WALLET_A}:${KEY_ID}:cycle-2026-10-22:24h`);

    // Repeated check 2 hours later still within 24 hours is prevented
    const serviceDay5Later = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => new Date("2026-10-22T02:00:00.000Z"),
    });

    const res3 = await serviceDay5Later.checkSubscription(candidate);
    expect(res3.status).toBe("skipped_duplicate");
    expect(sent).toHaveLength(2); // still only 2
  });

  it("skips 24-hour notification if wallet tops up holding after receiving 7-day warning", async () => {
    const { sink, sent } = createMockNotificationSink();

    // Day 1: 5 days remaining, holding = 20 < 100 -> 7d warning sent
    const day1Now = new Date("2026-10-17T12:00:00.000Z");
    const expiryDate = new Date("2026-10-22T12:00:00.000Z");

    const serviceDay1 = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => day1Now,
    });

    const candidateUnderfunded: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Alpha Pass",
      expiryDate,
      minHolding: "100",
      currentBalance: "20",
      cycleId: "cycle-oct-22",
    };

    await serviceDay1.checkSubscription(candidateUnderfunded);
    expect(sent).toHaveLength(1);

    // Day 5: 12 hours remaining, but wallet has topped up holding to 120 >= 100
    const day5Now = new Date("2026-10-22T00:00:00.000Z");
    const serviceDay5 = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => day5Now,
    });

    const candidateToppedUp: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Alpha Pass",
      expiryDate,
      minHolding: "100",
      currentBalance: "120", // Topped up!
      cycleId: "cycle-oct-22",
    };

    const res2 = await serviceDay5.checkSubscription(candidateToppedUp);
    expect(res2.status).toBe("skipped_meets_minimum_holding");
    expect(sent).toHaveLength(1); // Second notification skipped!
  });

  it("skips subscriptions that expire in more than 7 days", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    // 10 days remaining (> 7 days)
    const expiryDate = new Date("2026-10-27T12:00:00.000Z");

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Future Key",
      expiryDate,
      minHolding: "50",
      currentBalance: "0",
    };

    const res = await service.checkSubscription(candidate);
    expect(res.status).toBe("skipped_outside_window");
    expect(sent).toHaveLength(0);
  });

  it("skips subscriptions that have already expired", async () => {
    const { sink, sent } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    // Expired 1 hour ago
    const expiryDate = new Date("2026-10-17T11:00:00.000Z");

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Lapsed Key",
      expiryDate,
      minHolding: "50",
      currentBalance: "0",
    };

    const res = await service.checkSubscription(candidate);
    expect(res.status).toBe("skipped_already_expired");
    expect(sent).toHaveLength(0);
  });

  it("calculates expiry window from on-chain expiryLedger correctly", async () => {
    const { sink, sent } = createMockNotificationSink();
    const currentLedger = 1_000_000;
    // 5 days remaining in ledgers: 5 * 17,280 = 86,400 ledgers
    const expiryLedger = currentLedger + LEDGERS_PER_DAY * 5;

    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
      ledgersPerDay: LEDGERS_PER_DAY,
    });

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Ledger Key",
      expiryLedger,
      minHolding: "10",
      currentBalance: "2",
      currentLedger,
    } as SubscriptionCandidate & { currentLedger: number };

    const res = await service.checkSubscription(candidate);
    expect(res.status).toBe("notified");
    expect(res.window).toBe("7d");
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toContain("10 tokens");
  });

  it("resolves key name from CreatorKey repository if not provided on candidate", async () => {
    const { sink, sent } = createMockNotificationSink();
    const mockCreatorKeyRepo = {
      findById: jest.fn().mockResolvedValue({
        id: KEY_ID,
        name: "Creator Key From Repo",
        contractAddress: "CCONTRACT001",
      }),
      findByContractAddress: jest.fn().mockResolvedValue(null),
      applyConfigUpdate: jest.fn().mockResolvedValue(null),
    };

    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      creatorKeyRepository: mockCreatorKeyRepo,
      now: () => FIXED_NOW,
    });

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      expiryDate: new Date("2026-10-21T12:00:00.000Z"),
      minHolding: "100",
      currentBalance: "10",
    };

    await service.checkSubscription(candidate);

    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Subscription Expiring Soon: Creator Key From Repo");
    expect(sent[0].message).toContain("Creator Key From Repo");
  });

  it("resolves recipient userId from UserRepository matching wallet address", async () => {
    const { sink, sent } = createMockNotificationSink();
    const mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: "user-uuid-123",
        stellarAddress: WALLET_A,
      }),
    };

    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      userRepository: mockUserRepo as any,
      now: () => FIXED_NOW,
    });

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Test Key",
      expiryDate: new Date("2026-10-21T12:00:00.000Z"),
      minHolding: "10",
      currentBalance: "1",
    };

    await service.checkSubscription(candidate);

    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe("user-uuid-123");
  });

  it("checks live on-chain holding through SubscriptionHoldingReader if balance not in candidate", async () => {
    const { sink, sent } = createMockNotificationSink();
    const mockHoldingReader = {
      readHolding: jest.fn().mockResolvedValue({
        balance: "15",
        minBalance: "10", // 15 >= 10 -> meets holding!
        expiryLedger: 1_050_000,
        ledger: 1_000_000,
      }),
    };

    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      holdingReader: mockHoldingReader,
      now: () => FIXED_NOW,
    });

    const candidate: SubscriptionCandidate = {
      wallet: WALLET_A,
      keyId: KEY_ID,
      keyName: "Onchain Key",
      expiryDate: new Date("2026-10-21T12:00:00.000Z"),
    };

    const res = await service.checkSubscription(candidate);
    expect(mockHoldingReader.readHolding).toHaveBeenCalledWith({
      wallet: WALLET_A,
      keyId: KEY_ID,
    });
    expect(res.status).toBe("skipped_meets_minimum_holding");
    expect(sent).toHaveLength(0);
  });

  it("processes a batch of expiring subscriptions and aggregates metrics", async () => {
    const { sink } = createMockNotificationSink();
    const service = createSubscriptionExpiryNotifierService({
      notificationService: sink,
      now: () => FIXED_NOW,
    });

    const candidates: SubscriptionCandidate[] = [
      // 1: 5 days left, underfunded -> notify 7d
      {
        wallet: WALLET_A,
        keyId: KEY_ID,
        keyName: "Key 1",
        expiryDate: new Date("2026-10-22T12:00:00.000Z"),
        minHolding: "100",
        currentBalance: "10",
      },
      // 2: 12 hours left, underfunded -> notify 24h
      {
        wallet: WALLET_B,
        keyId: KEY_ID,
        keyName: "Key 2",
        expiryDate: new Date("2026-10-18T00:00:00.000Z"),
        minHolding: "100",
        currentBalance: "10",
      },
      // 3: 4 days left, fully funded -> skip meets holding
      {
        wallet: WALLET_A,
        keyId: "KEY_3",
        keyName: "Key 3",
        expiryDate: new Date("2026-10-21T12:00:00.000Z"),
        minHolding: "100",
        currentBalance: "150",
      },
      // 4: 15 days left -> skip outside window
      {
        wallet: WALLET_B,
        keyId: "KEY_4",
        keyName: "Key 4",
        expiryDate: new Date("2026-11-01T12:00:00.000Z"),
        minHolding: "100",
        currentBalance: "0",
      },
    ];

    const result = await service.processExpiringSubscriptions(candidates);

    expect(result.totalChecked).toBe(4);
    expect(result.notified7d).toBe(1);
    expect(result.notified24h).toBe(1);
    expect(result.skippedMeetsHolding).toBe(1);
    expect(result.skippedOutsideWindow).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  describe("Scheduled Daily Job & Worker", () => {
    it("runs daily job successfully using runSubscriptionExpiryJob", async () => {
      const { sink } = createMockNotificationSink();
      const mockCandidateSource = {
        findExpiringCandidates: jest.fn().mockResolvedValue([
          {
            wallet: WALLET_A,
            keyId: KEY_ID,
            keyName: "Scheduled Key",
            expiryDate: new Date("2026-10-21T12:00:00.000Z"),
            minHolding: "50",
            currentBalance: "5",
          },
        ]),
        recordNotificationSent: jest.fn().mockResolvedValue(undefined),
      };

      const notifier = createSubscriptionExpiryNotifierService({
        notificationService: sink,
        subscriptionSource: mockCandidateSource,
        now: () => FIXED_NOW,
      });

      const runResult = await runSubscriptionExpiryJob(notifier);

      expect(runResult.totalChecked).toBe(1);
      expect(runResult.notified7d).toBe(1);
      expect(mockCandidateSource.findExpiringCandidates).toHaveBeenCalledWith({
        withinDays: 7,
        currentDate: FIXED_NOW,
      });
      expect(mockCandidateSource.recordNotificationSent).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet: WALLET_A,
          keyId: KEY_ID,
          window: "7d",
        })
      );
    });

    it("schedules daily job and supports clean cancellation via stop()", () => {
      const { sink } = createMockNotificationSink();
      const notifier = createSubscriptionExpiryNotifierService({
        notificationService: sink,
      });

      const scheduler = scheduleSubscriptionExpiryJob(notifier);
      expect(typeof scheduler.stop).toBe("function");

      // Verify clean stop without errors or unhandled handles
      expect(() => scheduler.stop()).not.toThrow();
    });
  });
});
