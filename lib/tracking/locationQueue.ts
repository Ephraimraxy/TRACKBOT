/**
 * The delivery person's offline queue. When a point cannot be sent (no signal, a tunnel, a server hiccup) it is kept on
 * the phone with the time the GPS captured it, and sent later in one batch. The server stores each point under its
 * ORIGINAL capture time, treats it as history (it never becomes the current position), and ignores repeats.
 */
export interface QueuedPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Milliseconds since 1970 when the phone captured the fix. */
  capturedAt: number;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The server refuses points older than this, so there is no point keeping them. */
export const QUEUE_MAX_AGE_MS = 6 * 3600_000;
export const QUEUE_MAX_POINTS = 500;
export const BATCH_SIZE = 100;

export function createLocationQueue(store: Store | null, orderId: string, now: () => number = Date.now) {
  const key = `trackbot:location-queue:${orderId}`;
  let memory: QueuedPoint[] = [];

  const read = (): QueuedPoint[] => {
    if (!store) return memory;
    try {
      const parsed = JSON.parse(store.getItem(key) ?? "[]");
      return Array.isArray(parsed) ? (parsed as QueuedPoint[]) : [];
    } catch {
      return [];
    }
  };
  const write = (points: QueuedPoint[]) => {
    memory = points;
    if (!store) return;
    try {
      if (points.length === 0) store.removeItem(key);
      else store.setItem(key, JSON.stringify(points));
    } catch {
      // storage full or blocked: the in-memory copy still works for this session
    }
  };
  const fresh = (points: QueuedPoint[]) => points.filter((p) => now() - p.capturedAt <= QUEUE_MAX_AGE_MS);

  return {
    /** Keep a point for later. Oldest points are dropped first if the queue is full. */
    add(point: QueuedPoint) {
      const all = fresh([...read(), point]).sort((a, b) => a.capturedAt - b.capturedAt);
      write(all.slice(-QUEUE_MAX_POINTS));
    },
    /** Everything kept, oldest first. */
    all(): QueuedPoint[] {
      return fresh(read()).sort((a, b) => a.capturedAt - b.capturedAt);
    },
    size(): number {
      return this.all().length;
    },
    /** Remove the first `n` points (after they were sent). */
    drop(n: number) {
      write(this.all().slice(n));
    },
    clear() {
      write([]);
    },
  };
}

export type LocationQueue = ReturnType<typeof createLocationQueue>;

export type SendBatch = (points: QueuedPoint[]) => Promise<"sent" | "retry" | "stop">;

/**
 * Send what was kept, oldest first, in batches. Stops at the first batch that cannot be sent (keeping it for next time).
 * "stop" means the server says tracking is over for this order: the queue is emptied.
 */
export async function flushQueue(queue: LocationQueue, send: SendBatch): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  for (;;) {
    const batch = queue.all().slice(0, BATCH_SIZE);
    if (batch.length === 0) break;
    const outcome = await send(batch);
    if (outcome === "stop") {
      queue.clear();
      break;
    }
    if (outcome === "retry") break;
    queue.drop(batch.length);
    sent += batch.length;
  }
  return { sent, remaining: queue.size() };
}
