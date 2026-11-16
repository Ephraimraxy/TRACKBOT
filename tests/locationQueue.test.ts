import { describe, expect, it, vi } from "vitest";

import { BATCH_SIZE, createLocationQueue, flushQueue, QUEUE_MAX_AGE_MS, QUEUE_MAX_POINTS } from "@/lib/tracking/locationQueue";

const memoryStore = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
};
const NOW = 10_000_000_000;
const pt = (secondsAgo: number) => ({ latitude: 8.84, longitude: 7.87, accuracy: 10, capturedAt: NOW - secondsAgo * 1000 });

describe("offline location queue", () => {
  it("keeps points with their ORIGINAL capture times, oldest first, whatever order they were added in", () => {
    const q = createLocationQueue(memoryStore(), "o1", () => NOW);
    q.add(pt(10)); q.add(pt(50)); q.add(pt(30));
    expect(q.all().map((p) => p.capturedAt)).toEqual([NOW - 50_000, NOW - 30_000, NOW - 10_000]);
  });

  it("survives a page reload (it lives in storage), per order", () => {
    const store = memoryStore();
    createLocationQueue(store, "o1", () => NOW).add(pt(5));
    expect(createLocationQueue(store, "o1", () => NOW).size()).toBe(1);
    expect(createLocationQueue(store, "o2", () => NOW).size()).toBe(0);
  });

  it("drops points older than the server accepts, and the oldest when full", () => {
    const q = createLocationQueue(null, "o1", () => NOW);
    q.add({ ...pt(0), capturedAt: NOW - QUEUE_MAX_AGE_MS - 1000 });
    expect(q.size()).toBe(0);
    for (let i = 0; i < QUEUE_MAX_POINTS + 20; i++) q.add(pt(QUEUE_MAX_POINTS + 20 - i));
    expect(q.size()).toBe(QUEUE_MAX_POINTS);
    expect(q.all()[0].capturedAt).toBe(NOW - QUEUE_MAX_POINTS * 1000);
  });

  it("works with broken or missing storage", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => undefined };
    const q = createLocationQueue(broken, "o1", () => NOW);
    expect(() => q.add(pt(5))).not.toThrow();
    expect(q.size()).toBe(0); // unreadable storage reads as empty, and nothing throws
    const noStore = createLocationQueue(null, "o1", () => NOW);
    noStore.add(pt(5));
    expect(noStore.size()).toBe(1);
  });
});

describe("flushing the queue", () => {
  const filled = (n: number) => {
    const q = createLocationQueue(null, "o", () => NOW);
    for (let i = 0; i < n; i++) q.add(pt(n - i));
    return q;
  };

  it("sends oldest first, in batches, and empties the queue", async () => {
    const q = filled(BATCH_SIZE + 5);
    const seen: number[][] = [];
    const out = await flushQueue(q, async (points) => { seen.push(points.map((p) => p.capturedAt)); return "sent"; });
    expect(out).toEqual({ sent: BATCH_SIZE + 5, remaining: 0 });
    expect(seen).toHaveLength(2);
    expect(seen.flat()).toEqual([...seen.flat()].sort((a, b) => a - b)); // chronological across batches
  });

  it("keeps everything that was not accepted, and tries again next time", async () => {
    const q = filled(3);
    const send = vi.fn(async () => "retry" as const);
    expect(await flushQueue(q, send)).toEqual({ sent: 0, remaining: 3 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("empties the queue when the server says tracking is over", async () => {
    const q = filled(3);
    expect(await flushQueue(q, async () => "stop")).toEqual({ sent: 0, remaining: 0 });
  });
});
