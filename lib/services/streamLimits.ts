/**
 * Limits on live-tracking streams, so a few browser tabs (or a misbehaving client) cannot hold the server's
 * connections and database busy. In-memory: per server process. With several instances each enforces its own limit,
 * which still bounds each one.
 */
export const MAX_STREAMS_PER_USER = Number(process.env.TRACKING_MAX_STREAMS_PER_USER) || 5;
export const MAX_STREAMS_TOTAL = Number(process.env.TRACKING_MAX_STREAMS_TOTAL) || 500;

const perUser = new Map<string, number>();
let total = 0;

export type Admission = { ok: true; release: () => void } | { ok: false; reason: "user_limit" | "server_busy" };

/** Take a stream slot for a user. Call `release()` exactly once when the stream ends (extra calls are harmless). */
export function acquireStream(userId: string, limits = { perUser: MAX_STREAMS_PER_USER, total: MAX_STREAMS_TOTAL }): Admission {
  if (total >= limits.total) return { ok: false, reason: "server_busy" };
  const mine = perUser.get(userId) ?? 0;
  if (mine >= limits.perUser) return { ok: false, reason: "user_limit" };
  perUser.set(userId, mine + 1);
  total++;
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      total--;
      const n = (perUser.get(userId) ?? 1) - 1;
      if (n <= 0) perUser.delete(userId);
      else perUser.set(userId, n);
    },
  };
}

export const streamStats = () => ({ total, users: perUser.size });
/** Tests. */
export function resetStreamLimits() {
  perUser.clear();
  total = 0;
}
