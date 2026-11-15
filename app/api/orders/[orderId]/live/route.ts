import { NextRequest, NextResponse } from "next/server";
import { CommandeStatut } from "@prisma/client";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { sseMessage } from "@/lib/services/notificationStream";
import { createTrackingWatcher } from "@/lib/services/trackingStream";
import { createTrackingHub, type TrackingHub } from "@/lib/services/trackingHub";
import { acquireStream } from "@/lib/services/streamLimits";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHECK_MS = Number(process.env.TRACKING_CHECK_MS) || 1500;
// One shared watcher per order for the whole process (kept across dev reloads).
const g = globalThis as unknown as { __trackingHub?: TrackingHub };
const hub = (g.__trackingHub ??= createTrackingHub(prisma, { checkMs: CHECK_MS }));
const HEARTBEAT_MS = 15_000;
/** A connection is closed after this long; the browser reconnects by itself and carries on. */
const MAX_AGE_MS = 25 * 60_000;

/**
 * Live tracking of one order as Server-Sent Events. The page keeps this open and each new position, status or
 * estimate reaches it within about a second and a half of being stored, instead of waiting for the next poll.
 * Only people who may see the order (its customer, the owner, the assigned delivery person's own deliveries
 * excluded) get anything: the permission check is the same as for the ordinary tracking route.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  const { orderId } = await params;

  // At most a few open streams per person (and a cap for the server): a tab left open must not starve everyone else.
  const slot = acquireStream(session.user.id);
  if (!slot.ok) {
    return NextResponse.json({ error: slot.reason === "user_limit" ? "Too many live views are open. Close one and try again." : "The live view is busy. Try again in a moment." }, { status: 429, headers: { "Retry-After": "10" } });
  }

  // The permission check: the viewer reads the order as themselves. Only then do they join the shared watcher.
  const watcher = createTrackingWatcher(prisma, { orderId: String(orderId), actor: { id: session.user.id, role: session.user.role } });
  let first;
  try {
    first = await watcher.initial();
  } catch (error) {
    slot.release();
    return orderErrorResponse(error, "GET /api/orders/:id/live");
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let stop: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const close = () => {
        unsubscribe?.();
        slot.release();
        clearInterval(beat);
        clearTimeout(stop);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      write(`retry: 3000\n${sseMessage("tracking", first)}`);
      const finished = (s: CommandeStatut) => s === CommandeStatut.RECUE || s === CommandeStatut.ANNULEE;
      if (finished(first.status)) return close();

      unsubscribe = hub.subscribe(String(orderId), (changed) => {
        write(sseMessage("tracking", changed));
        if (finished(changed.status)) close();
      });
      beat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      stop = setTimeout(close, MAX_AGE_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      unsubscribe?.();
      slot.release();
      clearInterval(beat);
      clearTimeout(stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
