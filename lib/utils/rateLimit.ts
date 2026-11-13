/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Honest limitation: state lives in one server process. On serverless hosting
 * (several instances) each instance counts separately, so this is a basic brake
 * against a runaway client, not a hard guarantee. A shared store (e.g. Redis) would
 * be the production upgrade.
 */
export function createRateLimiter(options: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return function allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - options.windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= options.limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);

    // Keep memory bounded: drop idle keys occasionally.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k);
    }
    return true;
  };
}
