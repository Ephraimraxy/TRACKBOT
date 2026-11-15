import { UserRole, type PrismaClient } from "@prisma/client";

import { getTracking } from "@/lib/services/trackingService";
import { createTrackingWatcher } from "@/lib/services/trackingStream";

type Tracking = Awaited<ReturnType<typeof getTracking>>;
type Listener = (tracking: Tracking) => void;

interface Entry {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval>;
  busy: boolean;
}

/**
 * One watcher per order, shared by everyone watching it. Ten people (the customer on two devices, the owner, ...)
 * watching one delivery cost one cheap "did anything change?" query per interval, not ten, and the full picture is
 * built once per change and handed to all of them.
 *
 * Permission is NOT decided here: a viewer must pass the normal check (`getTracking` as themselves, via
 * `createTrackingWatcher(...).initial()`) before they are subscribed. The shared picture has no per-viewer parts:
 * the customer and the owner see the same tracking data.
 */
export function createTrackingHub(db: PrismaClient, options: { checkMs: number }) {
  const entries = new Map<string, Entry>();

  return {
    /** Start receiving changes for an order. Returns the function that stops. */
    subscribe(orderId: string, listener: Listener): () => void {
      let entry = entries.get(orderId);
      if (!entry) {
        // The shared watcher reads as the system (owner-level), since every subscriber was already authorised.
        const watcher = createTrackingWatcher(db, { orderId, actor: { id: "system", role: UserRole.ADMIN } });
        const created: Entry = { listeners: new Set(), busy: false, timer: undefined as never };
        created.timer = setInterval(async () => {
          if (created.busy) return;
          created.busy = true;
          try {
            // The first check sends one snapshot (nothing is "known" yet), so a change that happened between a
            // viewer's own first read and the hub starting is never missed.
            const changed = await watcher.check();
            if (changed) for (const l of [...created.listeners]) l(changed);
          } catch (error) {
            console.error("[tracking hub]", (error as Error).message);
          } finally {
            created.busy = false;
          }
        }, options.checkMs);
        entries.set(orderId, created);
        entry = created;
      }
      entry.listeners.add(listener);
      return () => {
        const e = entries.get(orderId);
        if (!e) return;
        e.listeners.delete(listener);
        if (e.listeners.size === 0) {
          clearInterval(e.timer);
          entries.delete(orderId);
        }
      };
    },
    /** How many orders are being watched, and by how many listeners (monitoring and tests). */
    stats: () => ({ orders: entries.size, listeners: [...entries.values()].reduce((n, e) => n + e.listeners.size, 0) }),
  };
}

export type TrackingHub = ReturnType<typeof createTrackingHub>;
