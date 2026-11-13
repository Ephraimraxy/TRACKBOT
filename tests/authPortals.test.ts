import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ signIn: vi.fn(async () => undefined), auth: vi.fn() }));

import { signIn } from "@/lib/auth";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { db, resetDb } from "./helpers";

const mockedSignIn = vi.mocked(signIn) as unknown as ReturnType<typeof vi.fn>;

let ipCounter = 0;
const call = (route: (req: NextRequest) => Promise<Response>, body: unknown, ip = `10.1.0.${++ipCounter}`) =>
  route(
    new NextRequest("http://localhost/api/auth/x", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );

const ADMIN = "owner@shop.test";
const CUSTOMER = "ada@shop.test";

async function makeUser(email: string, role: R, password: string) {
  return db.user.create({
    data: { email, password: await bcrypt.hash(password, 4), nom: "Test", prenom: "User", role, emailVerifie: true },
  });
}

beforeEach(async () => {
  await resetDb();
  mockedSignIn.mockClear();
  await makeUser(ADMIN, R.ADMIN, "owner-pass");
  await makeUser(CUSTOMER, R.CLIENT, "ada-pass");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

describe("sign-in at /auth/login (everyone)", () => {
  it("signs a customer in", async () => {
    const res = await call(loginRoute, { email: CUSTOMER, password: "ada-pass" });
    expect(res.status).toBe(200);
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("signs the administrator in as admin, with no message, so /admin is not compulsory", async () => {
    const res = await call(loginRoute, { email: ADMIN, password: "owner-pass" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("ADMIN");
    expect(body.error).toBeUndefined();
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("gives the same answer for a wrong password whether or not the email is the administrator's", async () => {
    const wrong = await call(loginRoute, { email: ADMIN, password: "guess-pass" });
    const unknown = await call(loginRoute, { email: "nobody@shop.test", password: "guess-pass" });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(mockedSignIn).not.toHaveBeenCalled();
  });
});

describe("sign-in at /admin", () => {
  it("signs the administrator in", async () => {
    const res = await call(loginRoute, { email: ADMIN, password: "owner-pass", portal: "admin" });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("ADMIN");
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("never signs a customer in, even with the right password", async () => {
    const res = await call(loginRoute, { email: CUSTOMER, password: "ada-pass", portal: "admin" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Incorrect credentials");
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("rejects a wrong administrator password", async () => {
    const res = await call(loginRoute, { email: ADMIN, password: "wrong-pass", portal: "admin" });
    expect(res.status).toBe(400);
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("slows down repeated guessing", async () => {
    const ip = "10.9.9.9";
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call(loginRoute, { email: ADMIN, password: `wrong-${i}-pass`, portal: "admin" }, ip)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe("customer sign-up at /auth/register", () => {
  const signUp = (email: string, password = "ada-pass") =>
    call(registerRoute, { email, password, nom: "Obi", prenom: "Chidi" });

  it("creates a customer account and signs them in, so the session is stored", async () => {
    const res = await signUp("new@shop.test");
    expect(res.status).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: "new@shop.test" } });
    expect(user.role).toBe(R.CLIENT);
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("cannot be used to create or take over the administrator email", async () => {
    vi.stubEnv("ADMIN_EMAIL", "Owner@Shop.test");
    const res = await signUp("OWNER@shop.test");
    expect(res.status).toBe(409);
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect((await db.user.findUniqueOrThrow({ where: { email: ADMIN } })).role).toBe(R.ADMIN);
  });

  it("reserves the admin email even before the admin account exists", async () => {
    await resetDb();
    vi.stubEnv("ADMIN_EMAIL", "future-owner@shop.test");
    const res = await signUp("future-owner@shop.test");
    expect(res.status).toBe(409);
    expect(await db.user.count()).toBe(0);
  });

  it("needs a password of at least 6 characters", async () => {
    const short = await signUp("short@shop.test", "12345");
    expect(short.status).toBe(400);
    expect(JSON.stringify((await short.json()).data)).toContain("at least 6");
    expect((await signUp("six@shop.test", "123456")).status).toBe(201);
  });

  it("accepts a password longer than 8 characters, and refuses one longer than bcrypt can read", async () => {
    expect((await signUp("long@shop.test", "a-fairly-long-password")).status).toBe(201);
    expect((await signUp("toolong@shop.test", "x".repeat(73))).status).toBe(400);
  });
});
