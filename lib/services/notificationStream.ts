import type { PrismaClient } from "@prisma/client";

export interface LiveNotification {
  id: string;
  type: string;
  objet: string;
  text: string;
  date: string;
  urlRedirection: string | null;
}

/** One message in the Server-Sent Events format. */
export function sseMessage(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Remembers how far through a person's notifications a stream has got. Notifications are read oldest first
 * from a timestamp; two can share the same millisecond, so the ids already sent at the newest timestamp are
 * remembered and skipped, which means none is sent twice and none is missed.
 */
export function createCursor(start: Date) {
  let at = start;
  let sentAtNewest = new Set<string>();
  return {
    get at() {
      return at;
    },
    advance(rows: { id: string; date: Date }[]) {
      for (const row of rows) {
        if (row.date.getTime() > at.getTime()) {
          at = row.date;
          sentAtNewest = new Set([row.id]);
        } else if (row.date.getTime() === at.getTime()) {
          sentAtNewest.add(row.id);
        }
      }
    },
    isNew(row: { id: string }) {
      return !sentAtNewest.has(row.id);
    },
  };
}

/** The notifications for `userId` that appeared after the cursor, oldest first. */
export async function newNotifications(
  db: PrismaClient,
  userId: string,
  cursor: ReturnType<typeof createCursor>,
  limit = 20
): Promise<LiveNotification[]> {
  const rows = await db.notification.findMany({
    where: { userId, date: { gte: cursor.at } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: limit + 20,
    select: { id: true, type: true, objet: true, text: true, date: true, urlRedirection: true },
  });
  const fresh = rows.filter((r) => cursor.isNew(r)).slice(0, limit);
  cursor.advance(fresh);
  return fresh.map((r) => ({ ...r, date: r.date.toISOString() }));
}
