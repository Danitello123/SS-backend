import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import type { Repository } from "typeorm";
import { logger as globalLogger, type AppLogger } from "../observability/logger";
import { NotificationType } from "../types/enums";
import type { User } from "../models/User.model";
import { KeySubscription } from "../models/KeySubscription.model";
import {
  LEDGERS_PER_DAY,
  type KeyHoldingReading,
  type SubscriptionHoldingReader,
  type SubscriptionStatusService,
} from "./subscription-status.service";
import type { CreatorKeyRepositoryContract } from "./creator-key.service";

export type ExpiryWarningWindow = "7d" | "24h";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * MS_PER_DAY;
export const TWENTY_FOUR_HOURS_MS = 24 * MS_PER_HOUR;

export interface SubscriptionCandidate {
  wallet: string;
  keyId: string;
  keyName?: string | null;
  expiryDate?: Date | string | null;
  expiryLedger?: number | null;
  minHolding?: string | number | Decimal;
  minBalance?: string | number | Decimal;
  currentBalance?: string | number | Decimal | null;
  balance?: string | number | Decimal | null;
  cycleId?: string | null;
  hasToppedUp?: boolean;
  toppedUp?: boolean;
  meetsMinimumHolding?: boolean;
}

export interface SubscriptionCandidateSource {
  findExpiringCandidates(options?: {
    withinDays?: number;
    currentLedger?: number;
    currentDate?: Date;
  }): Promise<SubscriptionCandidate[]>;
  recordNotificationSent?(input: {
    wallet: string;
    keyId: string;
    cycleId: string;
    window: ExpiryWarningWindow;
    sentAt: Date;
  }): Promise<void>;
}

export interface SubscriptionNotificationSink {
  createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>,
    dedupeKey?: string | null
  ): Promise<unknown>;
  findByDedupeKey?(dedupeKey: string): Promise<unknown>;
}

export interface SubscriptionDedupeStore {
  hasBeenSent(dedupeKey: string): Promise<boolean>;
  recordSent(dedupeKey: string): Promise<void>;
}

export interface SubscriptionExpiryNotifierDependencies {
  notificationService: SubscriptionNotificationSink;
  subscriptionSource?: SubscriptionCandidateSource;
  subscriptionStatusService?: SubscriptionStatusService;
  holdingReader?: SubscriptionHoldingReader;
  creatorKeyRepository?: CreatorKeyRepositoryContract;
  userRepository?: Repository<User>;
  dedupeStore?: SubscriptionDedupeStore;
  ledgersPerDay?: number;
  now?: () => Date;
  logger?: AppLogger;
}

export type CheckOutcomeStatus =
  | "notified"
  | "skipped_meets_minimum_holding"
  | "skipped_duplicate"
  | "skipped_outside_window"
  | "skipped_already_expired"
  | "error";

export interface SubscriptionCheckResult {
  wallet: string;
  keyId: string;
  keyName: string;
  window?: ExpiryWarningWindow;
  cycleId?: string;
  status: CheckOutcomeStatus;
  reason?: string;
  currentBalance?: string;
  minHolding?: string;
  expiryDate?: string;
  dedupeKey?: string;
  notificationId?: unknown;
}

export interface SubscriptionExpiryRunResult {
  runId: string;
  totalChecked: number;
  notified7d: number;
  notified24h: number;
  skippedMeetsHolding: number;
  skippedDuplicate: number;
  skippedOutsideWindow: number;
  skippedExpired: number;
  errors: Array<{ wallet: string; keyId: string; error: string }>;
  durationMs: number;
  results: SubscriptionCheckResult[];
}

export class InMemorySubscriptionDedupeStore implements SubscriptionDedupeStore {
  private readonly sentKeys = new Set<string>();

  async hasBeenSent(dedupeKey: string): Promise<boolean> {
    return this.sentKeys.has(dedupeKey);
  }

  async recordSent(dedupeKey: string): Promise<void> {
    this.sentKeys.add(dedupeKey);
  }

  clear(): void {
    this.sentKeys.clear();
  }
}

/**
 * Service that alerts subscribers when their key-based subscription is approaching expiry,
 * prompting them to maintain their minimum holding.
 *
 * Implements:
 * 1. 7-day warning notification dispatch
 * 2. 24-hour warning notification dispatch
 * 3. Notification skipped if wallet already meets minimum holding / topped up
 * 4. Content includes key name, expiry date, and minimum holding required
 * 5. Deduplication preventing multiple alerts for the same window & expiry cycle
 */
export class SubscriptionExpiryNotifierService {
  private readonly notificationService: SubscriptionNotificationSink;
  private readonly subscriptionSource?: SubscriptionCandidateSource;
  private readonly subscriptionStatusService?: SubscriptionStatusService;
  private readonly holdingReader?: SubscriptionHoldingReader;
  private readonly creatorKeyRepository?: CreatorKeyRepositoryContract;
  private readonly userRepository?: Repository<User>;
  private readonly dedupeStore: SubscriptionDedupeStore;
  private readonly ledgersPerDay: number;
  private readonly now: () => Date;
  private readonly logger: AppLogger;

  constructor(deps: SubscriptionExpiryNotifierDependencies) {
    this.notificationService = deps.notificationService;
    this.subscriptionSource = deps.subscriptionSource;
    this.subscriptionStatusService = deps.subscriptionStatusService;
    this.holdingReader = deps.holdingReader;
    this.creatorKeyRepository = deps.creatorKeyRepository;
    this.userRepository = deps.userRepository;
    this.dedupeStore = deps.dedupeStore ?? new InMemorySubscriptionDedupeStore();
    this.ledgersPerDay = deps.ledgersPerDay && deps.ledgersPerDay > 0 ? deps.ledgersPerDay : LEDGERS_PER_DAY;
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? globalLogger;
  }

  /**
   * Evaluates a single candidate subscription, determining whether a 7-day or 24-hour
   * warning should be dispatched or skipped.
   */
  async checkSubscription(candidate: SubscriptionCandidate): Promise<SubscriptionCheckResult> {
    const now = this.now();
    const keyName = await this.resolveKeyName(candidate);
    const { expiryDate, window, hoursRemaining, daysRemaining } = this.calculateExpiryWindow(candidate, now);

    if (hoursRemaining <= 0) {
      this.logger.debug("Subscription already expired; skipping approaching expiry warning", {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        hoursRemaining,
      });
      return {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        keyName,
        status: "skipped_already_expired",
        reason: "Subscription has already expired",
        expiryDate: expiryDate ? expiryDate.toISOString() : undefined,
      };
    }

    if (!window) {
      this.logger.debug("Subscription outside 7-day warning window; skipping", {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        daysRemaining,
      });
      return {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        keyName,
        status: "skipped_outside_window",
        reason: `Expires in ${daysRemaining.toFixed(1)} days; outside 7-day window`,
        expiryDate: expiryDate ? expiryDate.toISOString() : undefined,
      };
    }

    // Check if wallet meets minimum holding requirement (or topped up)
    const holdingCheck = await this.verifyHolding(candidate);
    if (holdingCheck.meetsHolding) {
      this.logger.info("Subscriber already meets minimum holding; skipping notification", {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        currentBalance: holdingCheck.currentBalance.toString(),
        minHolding: holdingCheck.minHolding.toString(),
      });
      return {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        keyName,
        window,
        status: "skipped_meets_minimum_holding",
        reason: "Wallet already meets minimum holding",
        currentBalance: holdingCheck.currentBalance.toString(),
        minHolding: holdingCheck.minHolding.toString(),
        expiryDate: expiryDate ? expiryDate.toISOString() : undefined,
      };
    }

    // Determine cycle identifier for deduplication
    const cycleId = this.resolveCycleId(candidate, expiryDate);
    const dedupeKey = `sub_expiry:${candidate.wallet}:${candidate.keyId}:${cycleId}:${window}`;

    // Deduplication check: prevent duplicate notifications for same cycle & window
    const alreadySent = await this.isDuplicate(dedupeKey);
    if (alreadySent) {
      this.logger.info("Notification already sent for this cycle and window; skipping duplicate", {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        cycleId,
        window,
        dedupeKey,
      });
      return {
        wallet: candidate.wallet,
        keyId: candidate.keyId,
        keyName,
        window,
        cycleId,
        dedupeKey,
        status: "skipped_duplicate",
        reason: `Duplicate notification prevented for cycle ${cycleId} and window ${window}`,
        currentBalance: holdingCheck.currentBalance.toString(),
        minHolding: holdingCheck.minHolding.toString(),
        expiryDate: expiryDate ? expiryDate.toISOString() : undefined,
      };
    }

    // Build notification content including key name, expiry date, and minimum holding required
    const formattedExpiry = expiryDate ? expiryDate.toISOString() : "approaching ledger expiry";
    const minHoldingStr = holdingCheck.minHolding.toString();
    const currentBalanceStr = holdingCheck.currentBalance.toString();

    const title =
      window === "24h"
        ? `Urgent: Subscription Expiring in 24 Hours - ${keyName}`
        : `Subscription Expiring Soon: ${keyName}`;

    const message =
      window === "24h"
        ? `Urgent: Your subscription for key "${keyName}" expires in less than 24 hours on ${formattedExpiry}. Maintain a minimum holding of ${minHoldingStr} tokens to prevent service disruption.`
        : `Your subscription for key "${keyName}" expires on ${formattedExpiry}. Maintain a minimum holding of ${minHoldingStr} tokens to retain uninterrupted access.`;

    const data: Record<string, unknown> = {
      keyId: candidate.keyId,
      keyName,
      expiryDate: formattedExpiry,
      expiry: formattedExpiry,
      minHolding: minHoldingStr,
      minimumHolding: minHoldingStr,
      currentBalance: currentBalanceStr,
      window,
      cycleId,
      daysRemaining: Math.max(0, Math.ceil(daysRemaining)),
      hoursRemaining: Math.max(0, Math.ceil(hoursRemaining)),
    };

    const recipientUserId = await this.resolveRecipientUserId(candidate.wallet);

    let notification: unknown = null;
    try {
      notification = await this.notificationService.createNotification(
        recipientUserId,
        NotificationType.SUBSCRIPTION,
        title,
        message,
        data,
        dedupeKey
      );
    } catch (err: unknown) {
      // If a database unique constraint prevented duplicate insertion concurrently, treat as duplicate
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("duplicate") || errMsg.includes("unique") || errMsg.includes("23505")) {
        this.logger.warn("Unique constraint captured duplicate notification concurrently", {
          dedupeKey,
          error: errMsg,
        });
        await this.recordSent(dedupeKey);
        return {
          wallet: candidate.wallet,
          keyId: candidate.keyId,
          keyName,
          window,
          cycleId,
          dedupeKey,
          status: "skipped_duplicate",
          reason: "Duplicate notification prevented by database constraint",
          currentBalance: currentBalanceStr,
          minHolding: minHoldingStr,
          expiryDate: formattedExpiry,
        };
      }
      throw err;
    }

    await this.recordSent(dedupeKey);

    if (this.subscriptionSource?.recordNotificationSent) {
      try {
        await this.subscriptionSource.recordNotificationSent({
          wallet: candidate.wallet,
          keyId: candidate.keyId,
          cycleId,
          window,
          sentAt: now,
        });
      } catch (err) {
        this.logger.warn("Failed to record notification sent in subscription source", {
          wallet: candidate.wallet,
          keyId: candidate.keyId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.info("Subscription expiry notification dispatched successfully", {
      wallet: candidate.wallet,
      keyId: candidate.keyId,
      window,
      cycleId,
      keyName,
      minHolding: minHoldingStr,
      formattedExpiry,
    });

    return {
      wallet: candidate.wallet,
      keyId: candidate.keyId,
      keyName,
      window,
      cycleId,
      dedupeKey,
      status: "notified",
      currentBalance: currentBalanceStr,
      minHolding: minHoldingStr,
      expiryDate: formattedExpiry,
      notificationId: notification,
    };
  }

  /**
   * Processes a batch of candidates or discovers expiring subscriptions from the source.
   */
  async processExpiringSubscriptions(
    candidates?: SubscriptionCandidate[]
  ): Promise<SubscriptionExpiryRunResult> {
    const startedAt = Date.now();
    const runId = randomUUID();

    const list =
      candidates ??
      (this.subscriptionSource
        ? await this.subscriptionSource.findExpiringCandidates({ withinDays: 7, currentDate: this.now() })
        : []);

    const results: SubscriptionCheckResult[] = [];
    const errors: Array<{ wallet: string; keyId: string; error: string }> = [];

    let notified7d = 0;
    let notified24h = 0;
    let skippedMeetsHolding = 0;
    let skippedDuplicate = 0;
    let skippedOutsideWindow = 0;
    let skippedExpired = 0;

    for (const candidate of list) {
      try {
        const result = await this.checkSubscription(candidate);
        results.push(result);

        if (result.status === "notified") {
          if (result.window === "24h") notified24h += 1;
          else if (result.window === "7d") notified7d += 1;
        } else if (result.status === "skipped_meets_minimum_holding") {
          skippedMeetsHolding += 1;
        } else if (result.status === "skipped_duplicate") {
          skippedDuplicate += 1;
        } else if (result.status === "skipped_outside_window") {
          skippedOutsideWindow += 1;
        } else if (result.status === "skipped_already_expired") {
          skippedExpired += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error("Error evaluating subscription candidate", {
          wallet: candidate.wallet,
          keyId: candidate.keyId,
          error: message,
        });
        errors.push({ wallet: candidate.wallet, keyId: candidate.keyId, error: message });
      }
    }

    const durationMs = Date.now() - startedAt;

    this.logger.info("Subscription expiry check batch complete", {
      runId,
      totalChecked: list.length,
      notified7d,
      notified24h,
      skippedMeetsHolding,
      skippedDuplicate,
      skippedOutsideWindow,
      skippedExpired,
      errorCount: errors.length,
      durationMs,
    });

    return {
      runId,
      totalChecked: list.length,
      notified7d,
      notified24h,
      skippedMeetsHolding,
      skippedDuplicate,
      skippedOutsideWindow,
      skippedExpired,
      errors,
      durationMs,
      results,
    };
  }

  /**
   * Scheduled daily job entry point.
   */
  async runDailyCheck(): Promise<SubscriptionExpiryRunResult> {
    return this.processExpiringSubscriptions();
  }

  private calculateExpiryWindow(
    candidate: SubscriptionCandidate,
    now: Date
  ): {
    expiryDate: Date | null;
    window: ExpiryWarningWindow | null;
    hoursRemaining: number;
    daysRemaining: number;
  } {
    let expiryDate: Date | null = null;
    let hoursRemaining = 0;
    let daysRemaining = 0;

    if (candidate.expiryDate) {
      expiryDate = candidate.expiryDate instanceof Date ? candidate.expiryDate : new Date(candidate.expiryDate);
      const diffMs = expiryDate.getTime() - now.getTime();
      hoursRemaining = diffMs / MS_PER_HOUR;
      daysRemaining = diffMs / MS_PER_DAY;
    } else if (Number.isFinite(candidate.expiryLedger as number)) {
      const expiryLedger = candidate.expiryLedger as number;
      // If current ledger is known, compute based on ~5s per ledger
      const currentLedger = (candidate as { currentLedger?: number }).currentLedger ?? 0;
      const ledgersRemaining = expiryLedger - currentLedger;
      daysRemaining = ledgersRemaining / this.ledgersPerDay;
      hoursRemaining = daysRemaining * 24;

      const estimatedMs = Math.round(daysRemaining * MS_PER_DAY);
      expiryDate = new Date(now.getTime() + estimatedMs);
    }

    let window: ExpiryWarningWindow | null = null;
    if (hoursRemaining > 0 && hoursRemaining <= 24) {
      window = "24h";
    } else if (daysRemaining > 0 && daysRemaining <= 7) {
      window = "7d";
    }

    return { expiryDate, window, hoursRemaining, daysRemaining };
  }

  private async verifyHolding(candidate: SubscriptionCandidate): Promise<{
    meetsHolding: boolean;
    currentBalance: Decimal;
    minHolding: Decimal;
  }> {
    // Explicit override flags
    if (candidate.meetsMinimumHolding === true || candidate.hasToppedUp === true || candidate.toppedUp === true) {
      const min = this.toDecimal(candidate.minHolding ?? candidate.minBalance ?? "0");
      const bal = this.toDecimal(candidate.currentBalance ?? candidate.balance ?? min);
      return { meetsHolding: true, currentBalance: bal, minHolding: min };
    }

    let currentBalance: Decimal | null = null;
    let minHolding: Decimal | null = null;

    if (candidate.currentBalance !== undefined && candidate.currentBalance !== null) {
      currentBalance = this.toDecimal(candidate.currentBalance);
    } else if (candidate.balance !== undefined && candidate.balance !== null) {
      currentBalance = this.toDecimal(candidate.balance);
    }

    if (candidate.minHolding !== undefined && candidate.minHolding !== null) {
      minHolding = this.toDecimal(candidate.minHolding);
    } else if (candidate.minBalance !== undefined && candidate.minBalance !== null) {
      minHolding = this.toDecimal(candidate.minBalance);
    }

    // If balance or minHolding was not provided on candidate, query live holding reader if present
    if (currentBalance === null || minHolding === null) {
      if (this.holdingReader) {
        try {
          const reading: KeyHoldingReading = await this.holdingReader.readHolding({
            wallet: candidate.wallet,
            keyId: candidate.keyId,
          });
          if (currentBalance === null) currentBalance = this.toDecimal(reading.balance);
          if (minHolding === null) minHolding = this.toDecimal(reading.minBalance);
        } catch (err) {
          this.logger.warn("Failed to read on-chain holding", {
            wallet: candidate.wallet,
            keyId: candidate.keyId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (this.subscriptionStatusService) {
        try {
          const status = await this.subscriptionStatusService.getStatus({
            wallet: candidate.wallet,
            keyId: candidate.keyId,
          });
          if (currentBalance === null) currentBalance = this.toDecimal(status.balance);
          if (minHolding === null) minHolding = this.toDecimal(status.minBalance);
        } catch (err) {
          this.logger.warn("Failed to get subscription status", {
            wallet: candidate.wallet,
            keyId: candidate.keyId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const finalBalance = currentBalance ?? new Decimal(0);
    const finalMin = minHolding ?? new Decimal(0);

    const meetsHolding = finalBalance.gte(finalMin);

    return { meetsHolding, currentBalance: finalBalance, minHolding: finalMin };
  }

  private resolveCycleId(candidate: SubscriptionCandidate, expiryDate: Date | null): string {
    if (candidate.cycleId) {
      return candidate.cycleId;
    }
    if (Number.isFinite(candidate.expiryLedger as number)) {
      return String(candidate.expiryLedger);
    }
    if (expiryDate) {
      return expiryDate.toISOString().slice(0, 10);
    }
    return "default-cycle";
  }

  private async isDuplicate(dedupeKey: string): Promise<boolean> {
    if (await this.dedupeStore.hasBeenSent(dedupeKey)) {
      return true;
    }
    if (this.notificationService.findByDedupeKey) {
      try {
        const found = await this.notificationService.findByDedupeKey(dedupeKey);
        if (found) {
          await this.dedupeStore.recordSent(dedupeKey);
          return true;
        }
      } catch {
        // Fall back to false if lookup fails
      }
    }
    return false;
  }

  private async recordSent(dedupeKey: string): Promise<void> {
    await this.dedupeStore.recordSent(dedupeKey);
  }

  private async resolveKeyName(candidate: SubscriptionCandidate): Promise<string> {
    if (candidate.keyName && candidate.keyName.trim()) {
      return candidate.keyName.trim();
    }
    if (this.creatorKeyRepository) {
      try {
        const key =
          (await this.creatorKeyRepository.findById(candidate.keyId)) ??
          (await this.creatorKeyRepository.findByContractAddress(candidate.keyId));
        if (key?.name) {
          return key.name;
        }
      } catch {
        // Fall back to keyId
      }
    }
    return candidate.keyId;
  }

  private async resolveRecipientUserId(wallet: string): Promise<string> {
    if (this.userRepository) {
      try {
        const user = await this.userRepository.findOne({ where: { stellarAddress: wallet } });
        if (user?.id) {
          return user.id;
        }
      } catch {
        // Fall back to wallet address
      }
    }
    return wallet;
  }

  private toDecimal(value: string | number | bigint | Decimal | null | undefined): Decimal {
    try {
      if (value === null || value === undefined) return new Decimal(0);
      if (value instanceof Decimal) return value;
      if (typeof value === "bigint") return new Decimal(value.toString());
      if (typeof value === "number") return Number.isFinite(value) ? new Decimal(value) : new Decimal(0);
      return new Decimal(String(value).trim() || "0");
    } catch {
      return new Decimal(0);
    }
  }
}

/**
 * Creates a TypeORM-backed candidate source that reads subscriptions from the database.
 */
export function createTypeOrmSubscriptionSource(
  repository: Repository<KeySubscription>,
  now: () => Date = () => new Date()
): SubscriptionCandidateSource {
  return {
    async findExpiringCandidates(options = {}) {
      const withinDays = options.withinDays ?? 7;
      const currentDate = options.currentDate ?? now();
      const maxExpiry = new Date(currentDate.getTime() + withinDays * MS_PER_DAY);

      const rows = await repository
        .createQueryBuilder("sub")
        .where("sub.isActive = :isActive", { isActive: true })
        .andWhere("sub.expiryDate IS NOT NULL")
        .andWhere("sub.expiryDate > :currentDate", { currentDate })
        .andWhere("sub.expiryDate <= :maxExpiry", { maxExpiry })
        .getMany();

      return rows.map((r) => ({
        wallet: r.wallet,
        keyId: r.keyId,
        keyName: r.keyName,
        minHolding: r.minHolding,
        currentBalance: r.currentBalance,
        expiryDate: r.expiryDate,
        expiryLedger: r.expiryLedger,
        cycleId: r.lastNotifiedCycle,
      }));
    },
    async recordNotificationSent(input) {
      const existing = await repository.findOne({
        where: { wallet: input.wallet, keyId: input.keyId },
      });
      if (existing) {
        existing.lastNotifiedCycle = input.cycleId;
        existing.lastNotifiedWindow = input.window;
        await repository.save(existing);
      }
    },
  };
}

export function createSubscriptionExpiryNotifierService(
  dependencies: SubscriptionExpiryNotifierDependencies
): SubscriptionExpiryNotifierService {
  return new SubscriptionExpiryNotifierService(dependencies);
}
