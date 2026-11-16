import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth/getAuth", () => ({ default: vi.fn() }));
vi.mock("@/lib/helpers/emailService", () => ({ triggerEmailVerification: vi.fn(async () => undefined) }));

import getAuth from "@/lib/auth/getAuth";
import { triggerEmailVerification } from "@/lib/helpers/emailService";
import { authorizeCredentials } from "@/lib/auth/credentials";
import { POST as sendCode } from "@/app/api/auth/email/send-verification-code/route";
import { POST as verifyCode } from "@/app/api/auth/email/verify/route";
import nextConfig from "@/next.config";
import { generateTOTPCode, generateTOTPSecret } from "@/lib/utils/totp";
import { db, resetDb } from "./helpers";

const mockedAuth = vi.mocked(getAuth) as unknown as ReturnType<typeof vi.fn>;
const post = (route: (r: NextRequest) => Promise<Response>, body: unknown) =>
  route(
    new NextRequest("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(async () => {
  await resetDb();
  vi.mocked(triggerEmailVerification).mockClear();
});
afterAll(() => db.$disconnect());

describe("credential check used by NextAuth's own endpoint", () => {
  it("accepts the right password, whatever the case of the email", async () => {
    await db.user.create({
      data: { email: "ada@shop.test", password: await bcrypt.hash("ada-pass", 4), nom: "A", prenom: "B", role: R.CLIENT },
    });
    expect((await authorizeCredentials({ email: "ADA@shop.test", password: "ada-pass" }))?.email).toBe("ada@shop.test");
  });

  it("answers a wrong password and an unknown account in exactly the same way", async () => {
    await db.user.create({
      data: { email: "bo@shop.test", password: await bcrypt.hash("bo-pass", 4), nom: "A", prenom: "B", role: R.CLIENT },
    });
    expect(await authorizeCredentials({ email: "bo@shop.test", password: "wrong" })).toBeNull();
    expect(await authorizeCredentials({ email: "nobody@shop.test", password: "wrong" })).toBeNull();
    expect(await authorizeCredentials({})).toBeNull();
  });

  it("stops guessing: after 10 tries a minute even the right password is refused", async () => {
    await db.user.create({
      data: { email: "cy@shop.test", password: await bcrypt.hash("cy-pass", 4), nom: "A", prenom: "B", role: R.CLIENT },
    });
    for (let i = 0; i < 10; i++) await authorizeCredentials({ email: "cy@shop.test", password: "nope" });
    expect(await authorizeCredentials({ email: "cy@shop.test", password: "cy-pass" })).toBeNull();
  });
});

describe("e-mail verification codes", () => {
  const session = (id: string, email: string) => mockedAuth.mockResolvedValue({ user: { id, email, emailVerifie: false } });

  it("allows 3 code e-mails per 10 minutes, then answers 429", async () => {
    const u = await db.user.create({
      data: { email: "dee@shop.test", password: "x", nom: "A", prenom: "B", role: R.CLIENT },
    });
    session(u.id, u.email);
    for (let i = 0; i < 3; i++) expect((await post(sendCode, { email: u.email })).status).toBe(200);
    expect((await post(sendCode, { email: u.email })).status).toBe(429);
    expect(triggerEmailVerification).toHaveBeenCalledTimes(3);
  });

  it("destroys the code after 5 wrong guesses, so it cannot be brute-forced", async () => {
    const u = await db.user.create({
      data: { email: "eli@shop.test", password: "x", nom: "A", prenom: "B", role: R.CLIENT },
    });
    const secret = generateTOTPSecret();
    await db.tOTPSecret.create({ data: { userId: u.id, secret, expiresLe: new Date(Date.now() + 300_000) } });
    session(u.id, u.email);
    const wrong = generateTOTPCode(secret) === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await post(verifyCode, { email: u.email, code: wrong })).status).toBe(400);
    // The 6th attempt is refused even with the correct code, and the code is gone.
    expect((await post(verifyCode, { email: u.email, code: generateTOTPCode(secret) })).status).toBe(429);
    expect(await db.tOTPSecret.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe("security headers", () => {
  it("are sent on every page and the framework banner is off", async () => {
    const rules = await nextConfig.headers!();
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    expect(rules[0].source).toBe("/:path*");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    expect(headers["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
