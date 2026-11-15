/**
 * The TrackBot Driver Android app (see /android) puts `window.TrackBotNative` in the page. When it is there, GPS sharing is
 * done by the app's foreground service, which keeps working with the screen off or the app in the background, and the
 * page only starts and stops it and shows its status. In an ordinary browser the object is absent and the page shares
 * the position itself, as before.
 */
export interface NativeTracker {
  isAvailable(): boolean;
  version(): string;
  /** "started", "needs_permission" (the person is being asked) or "invalid". */
  start(orderId: string): string;
  stop(): void;
  /** JSON, see {@link NativeStatus}. */
  status(): string;
}

export interface NativeStatus {
  tracking: boolean;
  orderId: string | null;
  /** Points kept on the phone, waiting for a connection. */
  queued: number;
  /** The server no longer accepts the app's sign-in: the person must sign in again in the app. */
  signedOut: boolean;
  lastSentAt: number | null;
  lastFix: { latitude: number; longitude: number; accuracy?: number; capturedAt: number } | null;
}

/** The app's bridge, or null in an ordinary browser (or if the object is not what we expect). */
export function nativeTracker(win: { TrackBotNative?: unknown } | undefined = typeof window === "undefined" ? undefined : (window as never)): NativeTracker | null {
  const n = win?.TrackBotNative as Partial<NativeTracker> | undefined;
  if (!n || typeof n.start !== "function" || typeof n.stop !== "function" || typeof n.status !== "function") return null;
  try {
    return n.isAvailable?.() === true ? (n as NativeTracker) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads the app's status JSON; null if it is not valid. Never trusts its shape. */
export function parseNativeStatus(json: string | null | undefined): NativeStatus | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (typeof o.tracking !== "boolean") return null;
    const fix = o.lastFix as Record<string, unknown> | null | undefined;
    return {
      tracking: o.tracking,
      orderId: typeof o.orderId === "string" ? o.orderId : null,
      queued: num(o.queued) && o.queued >= 0 ? Math.floor(o.queued) : 0,
      signedOut: o.signedOut === true,
      lastSentAt: num(o.lastSentAt) ? o.lastSentAt : null,
      lastFix: fix && num(fix.latitude) && num(fix.longitude) && num(fix.capturedAt) ? { latitude: fix.latitude, longitude: fix.longitude, capturedAt: fix.capturedAt, ...(num(fix.accuracy) ? { accuracy: fix.accuracy } : {}) } : null,
    };
  } catch {
    return null;
  }
}
