import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as sendCode } from "@/app/api/auth/password/send-reset-code/route";
import { POST as resetPassword } from "@/app/api/auth/password/reset/route";
import { db, resetDb } from "./helpers";

let ipCounter = 0;
const post = (handler: (req: Request) => Promise<Response>, body: unknown, ip = `10.9.0.${++ipCounter}`) =>
  handler(
    new Request("http://localhost/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

/** A fake Resend: records every email and lets the test read the code the "customer" received. */
function fakeMailbox(status = 200) {
  const sent: { to: string[]; subject: string; text: string; html: string }[] = [];
  const impl = vi.fn(async (_url: string, init: RequestInit) => {
    if (status === 200) sent.push(JSON.parse(init.body as string));
    return new Response("{}", { status });
  });
  vi.stubGlobal("fetch", impl);
  return {
    sent,
    impl,
    lastCode: () => {
      const m = sent.at(-1)?.text.match(/Your code: (\d{6})/);
      if (!m) throw new Error("no code email received");
      return m[1];
    },
  };
}

const makeUser = (email: string, password = "old-password-1") =>
  bcrypt.hash(password, 4).then((hash) => db.user.create({ data: { email, password: hash, nom: "T", prenom: "U", emailVerifie: true } }));

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "TrackBot <no-reply@shop.test>");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());

describe("POST /api/auth/password/send-reset-code", () => {
  it("emails a 6-digit code to a registered address", async () => {
    const box = fakeMailbox();
    await makeUser("owner@shop.test");

    const res = await post(sendCode, { email: "owner@shop.test" });

    expect(res.status).toBe(200);
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0].to).toEqual(["owner@shop.test"]);
    expect(box.sent[0].subject).toContain("password reset code");
    expect(box.lastCode()).toMatch(/^\d{6}$/);
    expect(await db.tOTPSecret.count()).toBe(1);
  });

  it("gives the same answer for an unknown address and sends nothing (no account probing)", async () => {
    const box = fakeMailbox();
    await makeUser("owner@shop.test");

    const known = await (await post(sendCode, { email: "owner@shop.test" })).json();
    const unknown = await post(sendCode, { email: "stranger@shop.test" });

    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(known);
    expect(box.sent).toHaveLength(1); // only the real account got an email
    expect(await db.tOTPSecret.count()).toBe(1);
  });

  it("finds the account regardless of letter case", async () => {
    const box = fakeMailbox();
    await makeUser("Mixed.Case@Shop.test");
    await post(sendCode, { email: "mixed.case@shop.test" });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0].to).toEqual(["Mixed.Case@Shop.test"]);
  });

  it("rejects malformed input", async () => {
    fakeMailbox();
    for (const body of [{}, { email: "not-an-email" }, { email: "" }, "not json"]) {
      expect((await post(sendCode, body)).status).toBe(400);
    }
  });

  it("limits how many codes can be requested for one address (no email flooding)", async () => {
    const box = fakeMailbox();
    await makeUser("flood@shop.test");
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(sendCode, { email: "flood@shop.test" })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(box.sent).toHaveLength(3);
  });

  it("still answers normally if the email provider is down, without exposing the problem", async () => {
    fakeMailbox(500);
    await makeUser("down@shop.test");
    const res = await post(sendCode, { email: "down@shop.test" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/resend|500|provider/i);
  });
});

describe("POST /api/auth/password/reset", () => {
  async function requestCode(email: string) {
    const box = fakeMailbox();
    await post(sendCode, { email });
    return box.lastCode();
  }

  it("sets a new password with the emailed code, and the code works only once", async () => {
    await makeUser("resetcase1@shop.test");
    const code = await requestCode("resetcase1@shop.test");

    const ok = await post(resetPassword, { email: "resetcase1@shop.test", code, newPassword: "my-new-password" });
    expect(ok.status).toBe(200);

    const user = await db.user.findUniqueOrThrow({ where: { email: "resetcase1@shop.test" } });
    expect(await bcrypt.compare("my-new-password", user.password)).toBe(true);
    expect(await bcrypt.compare("old-password-1", user.password)).toBe(false);
    expect(await db.tOTPSecret.count()).toBe(0);

    const again = await post(resetPassword, { email: "resetcase1@shop.test", code, newPassword: "another-password-2" });
    expect(again.status).toBe(400);
    const after = await db.user.findUniqueOrThrow({ where: { email: "resetcase1@shop.test" } });
    expect(after.password).toBe(user.password);
  });

  it("works for an address typed in a different letter case", async () => {
    await makeUser("Mixed@Shop.test");
    const code = await requestCode("mixed@shop.test");
    const res = await post(resetPassword, { email: "MIXED@SHOP.TEST", code, newPassword: "my-new-password" });
    expect(res.status).toBe(200);
  });

  it("a wrong code and an unknown account give the same answer (nothing to learn from it)", async () => {
    await makeUser("resetcase3@shop.test");
    const code = await requestCode("resetcase3@shop.test");
    const wrong = code === "123456" ? "654321" : "123456";

    const a = await post(resetPassword, { email: "resetcase3@shop.test", code: wrong, newPassword: "my-new-password" });
    const b = await post(resetPassword, { email: "nobody@shop.test", code: "123456", newPassword: "my-new-password" });

    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect((await a.json()).error).toBe((await b.json()).error);
    const user = await db.user.findUniqueOrThrow({ where: { email: "resetcase3@shop.test" } });
    expect(await bcrypt.compare("old-password-1", user.password)).toBe(true);
  });

  it("stops guessing: after 5 attempts the code is destroyed, even the correct one is refused", async () => {
    await makeUser("target@shop.test");
    const code = await requestCode("target@shop.test");
    const wrong = code === "123456" ? "654321" : "123456";

    for (let i = 0; i < 5; i++) {
      expect((await post(resetPassword, { email: "target@shop.test", code: wrong, newPassword: "my-new-password" })).status).toBe(400);
    }
    const sixth = await post(resetPassword, { email: "target@shop.test", code, newPassword: "my-new-password" });
    expect(sixth.status).toBe(429);
    expect(await db.tOTPSecret.count()).toBe(0);

    const user = await db.user.findUniqueOrThrow({ where: { email: "target@shop.test" } });
    expect(await bcrypt.compare("old-password-1", user.password)).toBe(true);
  });

  it("rejects an expired code and removes it", async () => {
    const owner = await makeUser("late@shop.test");
    const code = await requestCode("late@shop.test");
    await db.tOTPSecret.update({ where: { userId: owner.id }, data: { expiresLe: new Date(Date.now() - 1000) } });

    const res = await post(resetPassword, { email: "late@shop.test", code, newPassword: "my-new-password" });
    expect(res.status).toBe(400);
    expect(await db.tOTPSecret.count()).toBe(0);
  });

  it("requires a password of at least 6 characters, and a 6-digit code", async () => {
    await makeUser("short@shop.test");
    const code = await requestCode("short@shop.test");

    const weak = await post(resetPassword, { email: "short@shop.test", code, newPassword: "12345" });
    expect(weak.status).toBe(400);
    expect(JSON.stringify((await weak.json()).data)).toContain("newPassword");

    expect((await post(resetPassword, { email: "short@shop.test", code: "12ab56", newPassword: "my-new-password" })).status).toBe(400);
    expect((await post(resetPassword, "not json")).status).toBe(400);
    expect(await db.tOTPSecret.count()).toBe(1); // the valid code was not consumed by invalid input
  });
});
