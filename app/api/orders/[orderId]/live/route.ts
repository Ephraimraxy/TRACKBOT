import { NextRequest, NextResponse } from "next/server";
import { CommandeStatut } from "@prisma/client";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { sseMessage } from "@/lib/services/notificationStream";
import { createTrackingWatcher } from "@/lib/services/trackingStream";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHECK_MS = Number(process.env.TRACKING_CHECK_MS) || 1500;
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

  const watcher = createTrackingWatcher(prisma, { orderId: String(orderId), actor: { id: session.user.id, role: session.user.role } });
  let first;
  try {
    first = await watcher.initial();
  } catch (error) {
    return orderErrorResponse(error, "GET /api/orders/:id/live");
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
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
        clearInterval(timer);
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

      let busy = false;
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const changed = await watcher.check();
          if (changed) {
            write(sseMessage("tracking", changed));
            if (finished(changed.status)) close();
          }
        } catch (error) {
          console.error("[tracking stream]", (error as Error).message);
        } finally {
          busy = false;
        }
      }, CHECK_MS);
      beat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      stop = setTimeout(close, MAX_AGE_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(timer);
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
