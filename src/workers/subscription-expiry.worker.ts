import { DataSource } from "typeorm";
import { logger as defaultLogger, type AppLogger } from "../observability/logger";
import { KeySubscription } from "../models/KeySubscription.model";
import { User } from "../models/User.model";
import {
  SubscriptionExpiryNotifierService,
  createTypeOrmSubscriptionSource,
  type SubscriptionNotificationSink,
  type SubscriptionExpiryRunResult,
} from "../services/subscription-expiry-notifier.service";
import { createCreatorKeyRepository } from "../services/onchain-projection-repositories";

export interface SubscriptionExpiryWorkerDependencies {
  notifierService: SubscriptionExpiryNotifierService;
  logger?: AppLogger;
  now?: () => Date;
}

/**
 * Runs the daily subscription expiry notification check once.
 * Scans active subscriptions expiring within 7 days and dispatches 7-day and 24-hour warnings.
 */
export async function runSubscriptionExpiryJob(
  notifier: SubscriptionExpiryNotifierService,
  logger: AppLogger = defaultLogger
): Promise<SubscriptionExpiryRunResult> {
  const startedAt = Date.now();
  const jobDate = new Date().toISOString().slice(0, 10);

  logger.info("SubscriptionExpiryJob: Starting daily check", { jobDate });

  try {
    const result = await notifier.runDailyCheck();

    const durationMs = Date.now() - startedAt;
    logger.info("SubscriptionExpiryJob: Completed successfully", {
      jobDate,
      durationMs,
      totalChecked: result.totalChecked,
      notified7d: result.notified7d,
      notified24h: result.notified24h,
      skippedMeetsHolding: result.skippedMeetsHolding,
      skippedDuplicate: result.skippedDuplicate,
      skippedOutsideWindow: result.skippedOutsideWindow,
      skippedExpired: result.skippedExpired,
      errorsCount: result.errors.length,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error("SubscriptionExpiryJob: Failed", {
      jobDate,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Schedules the subscription expiry job to run daily.
 * Fires every 24 hours (calculated to align with midnight UTC), and returns a cancel handle.
 */
export function scheduleSubscriptionExpiryJob(
  notifier: SubscriptionExpiryNotifierService,
  logger: AppLogger = defaultLogger
): { stop: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function msUntilMidnightUTC(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
  }

  async function runJob(): Promise<void> {
    if (stopped) return;
    try {
      await runSubscriptionExpiryJob(notifier, logger);
    } catch {
      // Errors logged inside runSubscriptionExpiryJob
    }
  }

  const delayMs = msUntilMidnightUTC();
  logger.info("SubscriptionExpiryJob: Scheduled", {
    firstRunInMs: delayMs,
    firstRunAt: new Date(Date.now() + delayMs).toISOString(),
  });

  timeout = setTimeout(() => {
    if (stopped) return;
    void runJob();
    interval = setInterval(() => void runJob(), 24 * 60 * 60 * 1000);
    if (interval.unref) interval.unref();
  }, delayMs);

  if (timeout.unref) timeout.unref();

  return {
    stop: () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
      logger.info("SubscriptionExpiryJob: Cancelled schedule");
    },
  };
}

/**
 * Helper to construct the full notifier service wired with DataSource.
 */
export function buildSubscriptionExpiryNotifier(
  dataSource: DataSource,
  notificationService: SubscriptionNotificationSink,
  logger: AppLogger = defaultLogger
): SubscriptionExpiryNotifierService {
  const keySubRepo = dataSource.getRepository(KeySubscription);
  const userRepo = dataSource.getRepository(User);
  const creatorKeyRepo = createCreatorKeyRepository(dataSource);
  const subscriptionSource = createTypeOrmSubscriptionSource(keySubRepo);

  return new SubscriptionExpiryNotifierService({
    notificationService,
    subscriptionSource,
    creatorKeyRepository: creatorKeyRepo,
    userRepository: userRepo,
    logger,
  });
}
