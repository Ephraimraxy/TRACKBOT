import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/utils/prisma";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { createCursor, newNotifications, sseMessage } from "@/lib/services/notificationStream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;
/** A connection is closed after this long; the browser reconnects by itself and carries on. */
const MAX_AGE_MS = 25 * 60_000;

/**
 * Live notifications for the signed-in person, as Server-Sent Events. The page keeps this open and a new
 * notification (an order update, "your delivery is 5 min away", a new assignment) arrives within about two
 * seconds, without refreshing. Only that person's own notifications are ever sent.
 *
 * The browser reconnects automatically after any break and tells us the last notification it saw (the
 * Last-Event-ID header), so nothing is missed in between. A brand new connection starts from "now": it does
 * not replay old notifications.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  const userId = session.user.id;

  const resumeFrom = req.headers.get("last-event-id");
  const parsed = resumeFrom ? new Date(resumeFrom) : null;
  const cursor = createCursor(parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date());

  const pollMs = Number(process.env.NOTIFICATION_POLL_MS) || 2000;
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
          close(); // the browser has gone away
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

      write(`retry: 3000\n${sseMessage("ready", { ok: true })}`);

      let busy = false;
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          for (const n of await newNotifications(prisma, userId, cursor)) write(sseMessage("notification", n, n.date));
        } catch (error) {
          console.error("[notifications stream]", (error as Error).message);
        } finally {
          busy = false;
        }
      }, pollMs);
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
      "X-Accel-Buffering": "no", // tell proxies not to hold the stream back
    },
  });
}
