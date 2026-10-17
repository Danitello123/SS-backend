import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Keypair, Networks } from "stellar-sdk";
import { AuthService, LRUCache, processEfficiently, toPublicUser } from "@/services/auth.service";
import type { ChallengeRepositoryContract, UserRepositoryContract } from "@/services/auth.service";
import type { AppLogger, LogMetadata } from "@/observability/logger";
import { KYCStatus, UserType } from "@/types/enums";
import { User } from "@/models/User.model";
import { AppError, HttpError } from "@/utils/http-error";

interface InMemoryChallenge {
  id: string;
  stellarAddress: string;
  nonceHash: string;
  message: string;
  network: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

type InMemoryUser = User;

class InMemoryUserRepository implements UserRepositoryContract {
  readonly users = new Map<string, InMemoryUser>();
  public findByStellarAddressCallCount = 0;
  public saveCallCount = 0;

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  async findByStellarAddress(stellarAddress: string) {
    this.findByStellarAddressCallCount++;
    return [...this.users.values()].find((u) => u.stellarAddress === stellarAddress) ?? null;
  }

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async findAll(): Promise<InMemoryUser[]> {
    return [...this.users.values()].filter((u) => !u.deletedAt);
  }

  async count(): Promise<number> {
    return [...this.users.values()].filter((u) => !u.deletedAt).length;
  }

  async save(user: Partial<InMemoryUser>): Promise<InMemoryUser> {
    this.saveCallCount++;
    const now = new Date();
    const entity: InMemoryUser = {
      id: crypto.randomUUID(),
      stellarAddress: user.stellarAddress ?? "",
      email: user.email ?? null,
      userType: user.userType ?? UserType.INVESTOR,
      kycStatus: user.kycStatus ?? KYCStatus.PENDING,
      isKycVerified: user.isKycVerified ?? false,
      isSuspended: user.isSuspended ?? false,
      suspendedAt: user.suspendedAt ?? null,
      suspensionReason: user.suspensionReason ?? null,
      createdAt: user.createdAt ?? now,
      updatedAt: user.updatedAt ?? now,
      deletedAt: user.deletedAt ?? null,
      invoices: user.invoices ?? [],
      investments: user.investments ?? [],
      transactions: user.transactions ?? [],
      kycVerifications: user.kycVerifications ?? [],
      notifications: user.notifications ?? [],
      kycHistory: user.kycHistory ?? [],
      secondaryListings: user.secondaryListings ?? [],
      watchlistEntries: user.watchlistEntries ?? [],
    };
    this.users.set(entity.id, entity);
    return entity;
  }
}

class InMemoryChallengeRepository implements ChallengeRepositoryContract {
  readonly challenges = new Map<string, InMemoryChallenge>();
  public findByAddressAndNonceHashCallCount = 0;
  public consumeCallCount = 0;
  public deleteExpiredCallCount = 0;
  public countByStatusCallCount = 0;

  async create(input: InMemoryChallenge): Promise<InMemoryChallenge> {
    const challenge: InMemoryChallenge = {
      ...input,
      id: crypto.randomUUID(),
      consumedAt: null,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async findByAddressAndNonceHash(stellarAddress: string, nonceHash: string) {
    this.findByAddressAndNonceHashCallCount++;
    return (
      [...this.challenges.values()].find(
        (c) => c.stellarAddress === stellarAddress && c.nonceHash === nonceHash
      ) ?? null
    );
  }

  async consume(id: string, consumedAt: Date) {
    this.consumeCallCount++;
    const challenge = this.challenges.get(id);
    if (!challenge || challenge.consumedAt) return false;
    challenge.consumedAt = consumedAt;
    return true;
  }

  async deleteExpired(before: Date): Promise<number> {
    this.deleteExpiredCallCount++;
    let count = 0;
    for (const [id, challenge] of this.challenges.entries()) {
      if (challenge.expiresAt < before || (challenge.consumedAt && challenge.consumedAt < before)) {
        this.challenges.delete(id);
        count++;
      }
    }
    return count;
  }

  async countByStatus(status: "active" | "consumed" | "expired"): Promise<number> {
    this.countByStatusCallCount++;
    const now = new Date();
    let count = 0;
    for (const challenge of this.challenges.values()) {
      if (status === "active" && !challenge.consumedAt && challenge.expiresAt > now) count++;
      if (status === "consumed" && challenge.consumedAt) count++;
      if (status === "expired" && !challenge.consumedAt && challenge.expiresAt <= now) count++;
    }
    return count;
  }
}

interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata: LogMetadata;
}

class CaptureLogger implements AppLogger {
  constructor(readonly entries: LogEntry[] = []) {}

  debug(message: string, metadata: LogMetadata = {}): void {
    this.entries.push({ level: "debug", message, metadata });
  }
  info(message: string, metadata: LogMetadata = {}): void {
    this.entries.push({ level: "info", message, metadata });
  }
  warn(message: string, metadata: LogMetadata = {}): void {
    this.entries.push({ level: "warn", message, metadata });
  }
  error(message: string, metadata: LogMetadata = {}): void {
    this.entries.push({ level: "error", message, metadata });
  }
  child(): AppLogger {
    return new CaptureLogger(this.entries);
  }
}

describe("AuthService Optimization & Hardening", () => {
  describe("LRUCache data structure", () => {
    it("stores and retrieves key-value pairs within TTL", () => {
      const cache = new LRUCache<string, string>(5, 1000);
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.size).toBe(1);
    });

    it("evicts least recently used entry when max size is reached", () => {
      const cache = new LRUCache<string, number>(3, 10_000);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Access "a" to make it more recently used
      expect(cache.get("a")).toBe(1);

      // Insert "d", which should evict "b" (least recently used)
      cache.set("d", 4);

      expect(cache.get("b")).toBeUndefined();
      expect(cache.has("b")).toBe(false);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.size).toBe(3);
    });

    it("expires items after TTL", async () => {
      const cache = new LRUCache<string, string>(5, 20); // 20ms TTL
      cache.set("shortLived", "hello");
      expect(cache.get("shortLived")).toBe("hello");

      await new Promise((resolve) => setTimeout(resolve, 35));

      expect(cache.get("shortLived")).toBeUndefined();
      expect(cache.has("shortLived")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("deletes entries and clears the cache", () => {
      const cache = new LRUCache<string, string>(5, 10_000);
      cache.set("a", "1");
      cache.set("b", "2");

      expect(cache.delete("a")).toBe(true);
      expect(cache.delete("nonexistent")).toBe(false);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get("b")).toBeUndefined();
    });

    it("throws when initialized with non-positive maxSize", () => {
      expect(() => new LRUCache(0)).toThrow("LRUCache maxSize must be greater than zero");
      expect(() => new LRUCache(-1)).toThrow("LRUCache maxSize must be greater than zero");
    });
  });

  describe("processEfficiently concurrent processing helper", () => {
    it("executes a single task successfully", async () => {
      const result = await processEfficiently(async () => "success");
      expect(result).toBe("success");
    });

    it("executes multiple tasks concurrently with Promise.all", async () => {
      let task1Finished = false;
      let task2Finished = false;

      const [r1, r2] = await processEfficiently(
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          task1Finished = true;
          return 100;
        },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          task2Finished = true;
          return "two";
        }
      );

      expect(r1).toBe(100);
      expect(r2).toBe("two");
      expect(task1Finished).toBe(true);
      expect(task2Finished).toBe(true);
    });

    it("propagates errors if any concurrent task rejects", async () => {
      await expect(
        processEfficiently(
          async () => "ok",
          async () => {
            throw new Error("Task failed");
          }
        )
      ).rejects.toThrow("Task failed");
    });
  });

  describe("AuthService User Cache & Single-Flight Coalescing", () => {
    it("returns cached user without querying repository when userCacheTtlMs > 0", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const logger = new CaptureLogger();
      const keypair = Keypair.random();

      const user = await userRepo.save({ stellarAddress: keypair.publicKey() });

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
          userCacheTtlMs: 60_000, // Enable caching
        },
        logger,
      });

      const token = jwt.sign({ sub: keypair.publicKey() }, "test-secret", { expiresIn: "1h" });

      // First call hits the repository
      const firstUser = await service.getCurrentUser(token);
      expect(firstUser.stellarAddress).toBe(keypair.publicKey());
      expect(userRepo.findByStellarAddressCallCount).toBe(1);

      // Second call hits the in-memory cache
      const secondUser = await service.getCurrentUser(token);
      expect(secondUser.stellarAddress).toBe(keypair.publicKey());
      expect(userRepo.findByStellarAddressCallCount).toBe(1); // Call count didn't increase!
      expect(secondUser.id).toBe(user.id);
    });

    it("allows explicit invalidation of the user profile cache", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const keypair = Keypair.random();

      await userRepo.save({ stellarAddress: keypair.publicKey() });

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
          userCacheTtlMs: 60_000,
        },
      });

      const token = jwt.sign({ sub: keypair.publicKey() }, "test-secret", { expiresIn: "1h" });

      await service.getCurrentUser(token);
      expect(userRepo.findByStellarAddressCallCount).toBe(1);

      // Invalidate specifically for this address
      service.invalidateUserCache(keypair.publicKey());

      // Next request will re-query the repository
      await service.getCurrentUser(token);
      expect(userRepo.findByStellarAddressCallCount).toBe(2);

      // Invalidate all
      service.invalidateUserCache();
      await service.getCurrentUser(token);
      expect(userRepo.findByStellarAddressCallCount).toBe(3);
    });

    it("coalesces concurrent getCurrentUser calls for the same wallet via single-flight", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const keypair = Keypair.random();

      await userRepo.save({ stellarAddress: keypair.publicKey() });

      // Artificial delay in findByStellarAddress to test concurrent overlap
      const originalFindByStellar = userRepo.findByStellarAddress.bind(userRepo);
      userRepo.findByStellarAddress = async (addr) => {
        await new Promise((r) => setTimeout(r, 20));
        return originalFindByStellar(addr);
      };

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
          userCacheTtlMs: 0, // Cache disabled to isolate single-flight behavior
        },
      });

      const token = jwt.sign({ sub: keypair.publicKey() }, "test-secret", { expiresIn: "1h" });

      // Fire 5 concurrent requests simultaneously
      const results = await Promise.all([
        service.getCurrentUser(token),
        service.getCurrentUser(token),
        service.getCurrentUser(token),
        service.getCurrentUser(token),
        service.getCurrentUser(token),
      ]);

      expect(results).toHaveLength(5);
      for (const res of results) {
        expect(res.stellarAddress).toBe(keypair.publicKey());
      }

      // Repository was only queried once because of single-flight coalescing
      expect(userRepo.findByStellarAddressCallCount).toBe(1);
    });
  });

  describe("AuthService Metrics Caching & Coalescing", () => {
    it("caches challenge metrics and coalesces concurrent scrapes", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const logger = new CaptureLogger();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
          metricsCacheTtlMs: 5_000,
        },
        logger,
      });

      // Concurrent scrapes
      const [m1, m2, m3] = await Promise.all([
        service.getChallengeMetrics(),
        service.getChallengeMetrics(),
        service.getChallengeMetrics(),
      ]);

      expect(m1).toEqual(m2);
      expect(m2).toEqual(m3);
      // countByStatus was called 3 times (once per status: active, consumed, expired)
      expect(challengeRepo.countByStatusCallCount).toBe(3);

      // Subsequent call hits cache
      const m4 = await service.getChallengeMetrics();
      expect(m4).toEqual(m1);
      expect(challengeRepo.countByStatusCallCount).toBe(3);
    });
  });

  describe("verifyChallenge Concurrency & Early Validation", () => {
    it("rejects invalid signature early without hitting the challenge repository", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const keypair = Keypair.random();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
        },
      });

      // Malformed base64/hex signature
      await expect(
        service.verifyChallenge({
          publicKey: keypair.publicKey(),
          nonce: "a".repeat(32),
          signature: "not!valid!base64!",
        })
      ).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid signature.",
      });

      // Repository was NEVER called!
      expect(challengeRepo.findByAddressAndNonceHashCallCount).toBe(0);
    });

    it("rejects nonces that exceed maximum allowable length", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const keypair = Keypair.random();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
        },
      });

      await expect(
        service.verifyChallenge({
          publicKey: keypair.publicKey(),
          nonce: "x".repeat(513),
          signature: Buffer.alloc(64).toString("base64"),
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Invalid nonce.",
      });
    });

    it("rejects signatures that exceed maximum allowable length", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const keypair = Keypair.random();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
        },
      });

      await expect(
        service.verifyChallenge({
          publicKey: keypair.publicKey(),
          nonce: "a".repeat(32),
          signature: "a".repeat(2049),
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Invalid signature.",
      });
    });

    it("logs 'Failed to process' and throws AppError(500) if concurrent processing fails", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const logger = new CaptureLogger();
      const keypair = Keypair.random();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
        },
        logger,
      });

      const challenge = await service.createChallenge(keypair.publicKey());
      const signature = keypair.sign(Buffer.from(challenge.message, "utf8")).toString("base64");

      // Make upsertUser fail unexpectedly
      userRepo.save = async () => {
        throw new Error("Disk full or connection aborted");
      };

      await expect(
        service.verifyChallenge({
          publicKey: keypair.publicKey(),
          nonce: challenge.nonce,
          signature,
        })
      ).rejects.toThrow(AppError);

      const failedLog = logger.entries.find((e) => e.message === "Failed to process");
      expect(failedLog).toBeDefined();
      expect(failedLog?.level).toBe("error");
    });
  });

  describe("cleanupExpiredChallenges input hardening", () => {
    it("handles invalid or negative maxAgeMs gracefully by falling back to default", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();
      const logger = new CaptureLogger();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
        },
        logger,
      });

      // Pass negative maxAgeMs
      const deleted1 = await service.cleanupExpiredChallenges(-500);
      expect(deleted1).toBe(0);
      expect(challengeRepo.deleteExpiredCallCount).toBe(1);

      // Pass NaN
      const deleted2 = await service.cleanupExpiredChallenges(NaN);
      expect(deleted2).toBe(0);
      expect(challengeRepo.deleteExpiredCallCount).toBe(2);
    });
  });

  describe("getCurrentUser token length protection", () => {
    it("rejects oversized token (>8192 chars) with 401 unparseable_token", async () => {
      const userRepo = new InMemoryUserRepository();
      const challengeRepo = new InMemoryChallengeRepository();

      const service = new AuthService({
        userRepository: userRepo,
        challengeRepository: challengeRepo,
        config: {
          jwt: { secret: "test-secret", expiresIn: "1h" },
          auth: { challengeTtlMs: 60_000 },
          stellar: { network: "testnet", networkPassphrase: Networks.TESTNET },
        },
      });

      const hugeToken = "a".repeat(8193);
      await expect(service.getCurrentUser(hugeToken)).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid or expired token.",
      });
    });
  });
});
