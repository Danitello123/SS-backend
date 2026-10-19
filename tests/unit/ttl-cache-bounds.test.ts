import { DEFAULT_MAX_ENTRIES, TtlCache } from "../../src/lib/ttl-cache";

function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("TtlCache bounds (#633)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("defaults to a bounded capacity", () => {
    const cache = new TtlCache({ ttlSeconds: 60, sweepIntervalMs: 0 });
    expect(cache.maxEntries).toBe(DEFAULT_MAX_ENTRIES);
    expect(cache.maxEntries).toBeGreaterThan(0);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new TtlCache({ ttlSeconds: 60, maxEntries: 0 })).toThrow(/maxEntries/);
    expect(() => new TtlCache({ ttlSeconds: 60, maxEntries: -1 })).toThrow(/maxEntries/);
  });

  it("does not grow past maxEntries when distinct keys are written and never read", async () => {
    const cache = new TtlCache({ ttlSeconds: 300, maxEntries: 25, sweepIntervalMs: 0 });

    for (let i = 0; i < 5_000; i++) {
      await cache.set(`invoice-${i}`, { i });
    }

    expect(cache.size).toBe(25);
  });

  it("evicts the least recently used entry, not simply the oldest write", async () => {
    const cache = new TtlCache({ ttlSeconds: 300, maxEntries: 2, sweepIntervalMs: 0 });

    await cache.set("a", "value-a");
    await cache.set("b", "value-b");
    // Touch "a" so "b" becomes the least recently used entry.
    expect(await cache.get("a")).toBe("value-a");

    await cache.set("c", "value-c");

    expect(cache.size).toBe(2);
    expect(await cache.get("a")).toBe("value-a");
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("c")).toBe("value-c");
  });

  it("overwriting a key does not evict an unrelated entry", async () => {
    const cache = new TtlCache({ ttlSeconds: 300, maxEntries: 2, sweepIntervalMs: 0 });

    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("a", 3);

    expect(cache.size).toBe(2);
    expect(await cache.get("a")).toBe(3);
    expect(await cache.get("b")).toBe(2);
  });

  it("prunes expired entries on write", async () => {
    const clock = createClock();
    const cache = new TtlCache({
      ttlSeconds: 10,
      maxEntries: 100,
      sweepIntervalMs: 0,
      now: clock.now,
    });

    await cache.set("short", "x", 1);
    clock.advance(2_000);
    await cache.set("fresh", "y", 60);

    expect(cache.size).toBe(1);
    expect(await cache.get("short")).toBeNull();
    expect(await cache.get("fresh")).toBe("y");
  });

  it("sweeps expired entries on an interval", async () => {
    jest.useFakeTimers();
    const clock = createClock();
    const cache = new TtlCache({
      ttlSeconds: 2,
      sweepIntervalMs: 1_000,
      now: clock.now,
    });

    await cache.set("one", 1);
    await cache.set("two", 2);
    expect(cache.size).toBe(2);

    clock.advance(3_000);
    jest.advanceTimersByTime(1_000);

    expect(cache.size).toBe(0);

    cache.close();
  });

  it("does not keep the process alive for the sweeper", async () => {
    const cache = new TtlCache({ ttlSeconds: 60, sweepIntervalMs: 1_000 });
    await cache.set("one", 1);

    const timer = (cache as unknown as { sweepTimer: { unref?: () => void } | null }).sweepTimer;
    expect(timer).not.toBeNull();
    expect(typeof timer?.unref).toBe("function");

    cache.close();
  });

  it("close() stops sweeping and is idempotent", async () => {
    const cache = new TtlCache({ ttlSeconds: 60, sweepIntervalMs: 1_000 });
    await cache.set("one", 1);

    expect(() => {
      cache.close();
      cache.close();
    }).not.toThrow();
    expect((cache as unknown as { sweepTimer: unknown }).sweepTimer).toBeNull();
  });

  it("stays bounded when reading from the redis mirror as well", async () => {
    const cache = new TtlCache({
      ttlSeconds: 300,
      maxEntries: 10,
      sweepIntervalMs: 0,
      redisClient: {
        get: async (key: string) => JSON.stringify({ key }),
        set: async () => "OK",
        del: async () => 1,
      },
    });

    for (let i = 0; i < 500; i++) {
      await cache.get(`missing-${i}`);
    }

    expect(cache.size).toBe(10);
  });
});
