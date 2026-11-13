import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationType, UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET as streamRoute } from "@/app/api/notifications/stream/route";
import { GET as settingsGet, PATCH as settingsPatch, POST as settingsTest } from "@/app/api/users/[userId]/settings/delivery-updates/route";
import { createCursor, newNotifications, sseMessage } from "@/lib/services/notificationStream";
import { db, makeUser, resetDb } from "./helpers";

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const loginAs = (u: { id: string; role: R } | null) => mockedAuth.mockResolvedValue(u ? { user: { id: u.id, role: u.role, email: "x@y.z" } } : null);

// async, so the query runs as soon as this is called (a Prisma query is lazy until awaited)
const note = async (userId: string, objet: string, date = new Date()) =>
  db.notification.create({ data: { userId, objet, text: `${objet} text`, type: NotificationType.LIVRAISON, date } });

/** Reads Server-Sent Events from a response until `count` events have arrived (or the time is up). */
async function readEvents(res: Response, count: number, ms = 3000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: any; id?: string }[] = [];
  let buffer = "";
  const deadline = Date.now() + ms;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  while (events.length < count && Date.now() < deadline) {
    pending ??= reader.read();
    const chunk = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 200))]);
    if (!chunk) continue; // not arrived yet: keep waiting on the SAME read
    pending = null;
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value);
    let at;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data), id: /^id: (.*)$/m.exec(block)?.[1] });
    }
  }
  await reader.cancel().catch(() => undefined);
  return events;
}

const open = (headers: Record<string, string> = {}, signal?: AbortSignal) =>
  streamRoute(new NextRequest("http://localhost/api/notifications/stream", { headers, signal }));

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
  vi.stubEnv("NOTIFICATION_POLL_MS", "40");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

describe("what the stream reads", () => {
  it("reads only the person's own notifications, oldest first, after the cursor", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const t = (s: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, s));
    await note(me.id, "old", t(0));
    await note(me.id, "second", t(20));
    await note(me.id, "first", t(10));
    await note(other.id, "not mine", t(15));

    const cursor = createCursor(t(5));
    const got = await newNotifications(db, me.id, cursor);
    expect(got.map((n) => n.objet)).toEqual(["first", "second"]);
    expect(await newNotifications(db, me.id, cursor)).toEqual([]); // nothing is sent twice
  });

  it("does not drop or repeat notifications created in the same millisecond", async () => {
    const me = await makeUser();
    const same = new Date(Date.UTC(2026, 10, 2, 10, 0, 0, 500));
    const cursor = createCursor(new Date(same.getTime() - 1));
    await note(me.id, "a", same);
    expect((await newNotifications(db, me.id, cursor)).map((n) => n.objet)).toEqual(["a"]);
    await note(me.id, "b", same); // arrives later, same millisecond
    expect((await newNotifications(db, me.id, cursor)).map((n) => n.objet)).toEqual(["b"]);
    expect(await newNotifications(db, me.id, cursor)).toEqual([]);
  });

  it("formats Server-Sent Events correctly", () => {
    expect(sseMessage("notification", { a: 1 }, "id-1")).toBe('id: id-1\nevent: notification\ndata: {"a":1}\n\n');
    expect(sseMessage("ready", { ok: true })).toBe('event: ready\ndata: {"ok":true}\n\n');
  });
});

describe("GET /api/notifications/stream", () => {
  it("needs a signed-in person", async () => {
    loginAs(null);
    expect((await open()).status).toBe(401);
  });

  it("opens as an event stream and says it is ready", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    const res = await open();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect((await readEvents(res, 1))[0].event).toBe("ready");
  });

  it("delivers a notification that is created while the person is connected, within a moment", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    const res = await open();
    setTimeout(() => void note(me.id, "Your delivery is 5 min away"), 150);

    const events = await readEvents(res, 2);
    const live = events.find((e) => e.event === "notification");
    expect(live?.data).toMatchObject({ objet: "Your delivery is 5 min away", type: "LIVRAISON" });
  });

  it("never delivers someone else's notification, and does not replay old ones on a fresh connection", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await note(me.id, "from before I connected", new Date(Date.now() - 60_000));
    loginAs({ id: me.id, role: R.CLIENT });
    const res = await open();
    setTimeout(() => void note(other.id, "private to someone else"), 100);
    setTimeout(() => void note(me.id, "mine"), 250);

    const events = (await readEvents(res, 3)).filter((e) => e.event === "notification");
    expect(events.map((e) => e.data.objet)).toEqual(["mine"]);
  });

  it("resumes from the last notification the browser saw, missing nothing and repeating nothing", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    const lastSeen = new Date(Date.now() - 10_000);
    await note(me.id, "seen already", new Date(lastSeen.getTime() - 1000));
    await note(me.id, "arrived while offline", new Date(lastSeen.getTime() + 1000));

    const res = await open({ "last-event-id": lastSeen.toISOString() });
    const events = (await readEvents(res, 2)).filter((e) => e.event === "notification");
    expect(events.map((e) => e.data.objet)).toEqual(["arrived while offline"]);
  });

  it("closes when the browser goes away", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    const abort = new AbortController();
    const res = await open({}, abort.signal);
    const reader = res.body!.getReader();
    await reader.read(); // ready
    abort.abort();
    const end = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r("still open"), 1500))]);
    expect(end).not.toBe("still open");
  });
});

describe("delivery update settings", () => {
  const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });
  const patch = (userId: string, body: unknown) =>
    settingsPatch(new NextRequest("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(userId));

  it("starts with sensible defaults: a reminder every 5 minutes and the almost-here alert on", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    const res = await settingsGet(new NextRequest("http://localhost/x"), ctx(me.id));
    expect((await res.json()).data).toEqual({ rappelLivraisonMinutes: 5, alerteProche: true });
  });

  it("lets a customer choose their reminder interval, including off", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    for (const minutes of [2, 10, 30, 0]) {
      expect((await patch(me.id, { rappelLivraisonMinutes: minutes })).status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).rappelLivraisonMinutes).toBe(minutes);
    }
    expect((await patch(me.id, { alerteProche: false })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).alerteProche).toBe(false);
  });

  it("refuses values that are not on the menu, or nothing at all", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    for (const bad of [{ rappelLivraisonMinutes: 7 }, { rappelLivraisonMinutes: -1 }, { rappelLivraisonMinutes: "5" }, { alerteProche: "yes" }, {}]) {
      expect((await patch(me.id, bad)).status).toBe(400);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).rappelLivraisonMinutes).toBe(5);
  });

  it("is private: not signed in, or someone else's settings", async () => {
    const me = await makeUser();
    const other = await makeUser();
    loginAs(null);
    expect((await patch(me.id, { rappelLivraisonMinutes: 2 })).status).toBe(401);
    loginAs({ id: other.id, role: R.CLIENT });
    expect((await patch(me.id, { rappelLivraisonMinutes: 2 })).status).toBe(403);
    expect((await settingsGet(new NextRequest("http://localhost/x"), ctx(me.id))).status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).rappelLivraisonMinutes).toBe(5);
  });

  it("sends a test notification to the person who asked, with a limit on how many", async () => {
    const me = await makeUser();
    loginAs({ id: me.id, role: R.CLIENT });
    const send = () => settingsTest(new NextRequest("http://localhost/x", { method: "POST" }), ctx(me.id));
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
    expect(await db.notification.count({ where: { userId: me.id, objet: "Test notification" } })).toBe(5);
  });
});
