/**
 * Minimal TTL cache used by the read-only on-chain projection endpoints
 * (creator key buy limits, contract ACL, curve migrations, swap history).
 *
 * Values are cached in-process and optionally mirrored into Redis so that
 * multiple API instances share the same warm cache. Redis is strictly best
 * effort: any connection/command failure degrades to the in-process map rather
 * than failing the request.
 *
 * The in-process map is bounded: it holds at most `maxEntries` entries, evicts
 * the least recently used one when full, and periodically drops expired
 * entries. Without those bounds, keys that are written once and never read
 * (or keys with randomized ids) would accumulate for the lifetime of the
 * process and eventually exhaust the heap.
 */

export interface TtlCacheOptions {
  /** Entry lifetime in seconds. */
  ttlSeconds: number;
  /** Prefix for Redis keys, so invalidation can be scoped per feature. */
  namespace?: string;
  /** Optional ioredis-compatible client. When omitted the cache is memory-only. */
  redisClient?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
  };
  enabled?: boolean;
  /** Injectable clock, for deterministic TTL assertions in tests. */
  now?: () => number;
  /** Maximum number of in-process entries before LRU eviction. */
  maxEntries?: number;
  /**
   * How often expired entries are swept, in milliseconds. Sweeping is skipped
   * while the cache holds nothing. Set to 0 to disable the timer and rely on
   * lazy expiry plus pruning on write.
   */
  sweepIntervalMs?: number;
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export const DEFAULT_MAX_ENTRIES = 5000;

/** Expired entries are swept at most this often, and at least once a minute. */
function defaultSweepIntervalMs(ttlSeconds: number): number {
  return Math.max(1_000, Math.min(ttlSeconds * 1000, 60_000));
}

export class TtlCache {
  readonly ttlSeconds: number;
  readonly maxEntries: number;
  private readonly namespace: string;
  private readonly redis?: TtlCacheOptions["redisClient"];
  private readonly enabled: boolean;
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;
  /** Insertion order doubles as recency order: a hit is re-inserted at the end. */
  private readonly memory = new Map<string, MemoryEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TtlCacheOptions) {
    if (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) {
      throw new Error("TtlCache requires a positive ttlSeconds.");
    }
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("TtlCache requires a positive integer maxEntries.");
    }
    const sweepIntervalMs = options.sweepIntervalMs ?? defaultSweepIntervalMs(options.ttlSeconds);
    if (!Number.isFinite(sweepIntervalMs) || sweepIntervalMs < 0) {
      throw new Error("TtlCache requires a non-negative sweepIntervalMs.");
    }

    this.ttlSeconds = options.ttlSeconds;
    this.maxEntries = maxEntries;
    this.namespace = options.namespace ?? "cache";
    this.redis = options.redisClient;
    this.enabled = options.enabled !== false;
    this.now = options.now ?? (() => Date.now());
    this.sweepIntervalMs = sweepIntervalMs;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTtlSeconds(): number {
    return this.ttlSeconds;
  }

  /** Number of entries currently held in-process, expired ones included. */
  get size(): number {
    return this.memory.size;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    const namespaced = this.buildKey(key);

    if (this.redis) {
      try {
        const raw = await this.redis.get(namespaced);
        if (raw !== null) {
          this.remember(namespaced, raw);
          return JSON.parse(raw) as T;
        }
        return null;
      } catch {
        // fall through to the in-process copy
      }
    }

    const entry = this.memory.get(namespaced);
    if (!entry) return null;
    if (this.now() > entry.expiresAt) {
      this.memory.delete(namespaced);
      return null;
    }
    // Reading refreshes recency so hot keys outlive a burst of one-off writes.
    this.memory.delete(namespaced);
    this.memory.set(namespaced, entry);
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      this.memory.delete(namespaced);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.enabled) return;
    const namespaced = this.buildKey(key);
    const ttl = ttlSeconds ?? this.ttlSeconds;
    const serialized = JSON.stringify(value);

    if (this.redis) {
      try {
        await this.redis.set(namespaced, serialized, "EX", ttl);
      } catch {
        // best effort only
      }
    }

    this.memory.delete(namespaced);
    this.memory.set(namespaced, { value: serialized, expiresAt: this.now() + ttl * 1000 });
    this.pruneExpired();
    this.evictToCapacity();
    this.ensureSweeper();
  }

  /** Drops a single entry from both the in-process map and Redis. */
  async delete(key: string): Promise<void> {
    if (!this.enabled) return;
    const namespaced = this.buildKey(key);
    this.memory.delete(namespaced);

    if (this.redis) {
      try {
        await this.redis.del(namespaced);
      } catch {
        // best effort only
      }
    }
  }

  /** Drops every in-process entry whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void {
    const namespaced = this.buildKey(prefix);
    for (const key of this.memory.keys()) {
      if (key.startsWith(namespaced)) {
        this.memory.delete(key);
      }
    }
  }

  /** Drops every entry held in-process (Redis entries expire via their TTL). */
  clear(): void {
    this.memory.clear();
  }

  /** Removes expired entries and returns how many were dropped. */
  pruneExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.memory) {
      if (now > entry.expiresAt) {
        this.memory.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Stops the background sweeper. Safe to call more than once. */
  close(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private evictToCapacity(): void {
    while (this.memory.size > this.maxEntries) {
      // Map iteration order is insertion order, which the read path refreshes,
      // so the first key is the least recently used one.
      const oldest = this.memory.keys().next();
      if (oldest.done) return;
      this.memory.delete(oldest.value);
    }
  }

  private ensureSweeper(): void {
    if (this.sweepTimer || this.sweepIntervalMs === 0 || !this.enabled) return;
    this.sweepTimer = setInterval(() => {
      if (this.memory.size === 0) {
        this.close();
        return;
      }
      this.pruneExpired();
    }, this.sweepIntervalMs);
    // Never hold the process open just to sweep a cache.
    if (typeof this.sweepTimer.unref === "function") {
      this.sweepTimer.unref();
    }
  }

  private remember(key: string, raw: string, ttlSeconds?: number): void {
    const ttl = ttlSeconds ?? this.ttlSeconds;
    this.memory.delete(key);
    this.memory.set(key, { value: raw, expiresAt: this.now() + ttl * 1000 });
    this.evictToCapacity();
    this.ensureSweeper();
  }

  private buildKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}

export function createTtlCache(options: TtlCacheOptions): TtlCache {
  return new TtlCache(options);
}
