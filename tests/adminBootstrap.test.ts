import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole as R } from "@prisma/client";

import { ensureAdmin } from "@/lib/seed/ensureAdmin";
import { db, resetDb } from "./helpers";

const EMAIL = "Owner@Shop.test";
const email = "owner@shop.test";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("ensureAdmin (email only)", () => {
  it("creates a verified administrator from just an email, with a password nobody knows", async () => {
    expect(await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_FIRST_NAME: "Ada", ADMIN_LAST_NAME: "Obi" })).toBe("created");

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: R.ADMIN, emailVerifie: true, prenom: "Ada", nom: "Obi" });
    expect(user.password).toMatch(/^\$2[aby]\$/); // a bcrypt hash, not plain text
    expect(await db.admin.count({ where: { userId: user.id } })).toBe(1);
    // Cannot be logged into with any of the obvious guesses.
    for (const guess of ["", "password", "admin", "Test1234!", EMAIL]) {
      expect(await bcrypt.compare(guess, user.password)).toBe(false);
    }
  });

  it("each new account gets a different random password", async () => {
    await ensureAdmin(db, { ADMIN_EMAIL: "a@shop.test" });
    await ensureAdmin(db, { ADMIN_EMAIL: "b@shop.test" });
    const [a, b] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: "a@shop.test" } }),
      db.user.findUniqueOrThrow({ where: { email: "b@shop.test" } }),
    ]);
    expect(a.password).not.toBe(b.password);
  });

  it("is idempotent and NEVER overwrites a password the owner chose", async () => {
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL });
    const chosen = await bcrypt.hash("my-own-new-password", 10);
    await db.user.update({ where: { email }, data: { password: chosen } });

    // Every later start-up bootstrap leaves it alone when no ADMIN_PASSWORD is set.
    expect(await ensureAdmin(db, { ADMIN_EMAIL: EMAIL }, { optional: true })).toBe("updated");

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.password).toBe(chosen);
    expect(await db.user.count()).toBe(1);
    expect(await db.admin.count()).toBe(1);
  });

  it("promotes an existing customer with that email without touching their password", async () => {
    const original = await bcrypt.hash("customer-password", 10);
    await db.user.create({ data: { email, password: original, nom: "A", prenom: "B", role: R.CLIENT } });

    expect(await ensureAdmin(db, { ADMIN_EMAIL: EMAIL }, { optional: true })).toBe("updated");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe(R.ADMIN);
    expect(user.password).toBe(original);
  });

  it("start-up bootstrap does nothing when ADMIN_EMAIL is not set", async () => {
    expect(await ensureAdmin(db, {}, { optional: true })).toBe("skipped");
    expect(await ensureAdmin(db, { ADMIN_PASSWORD: "some-password" }, { optional: true })).toBe("skipped");
    expect(await db.user.count()).toBe(0);
  });

  it("rejects an invalid email and writes nothing", async () => {
    await expect(ensureAdmin(db, { ADMIN_EMAIL: "not-an-email" })).rejects.toThrow(/ADMIN_EMAIL/);
    await expect(ensureAdmin(db, {})).rejects.toThrow(/ADMIN_EMAIL/);
    await expect(ensureAdmin(db, { ADMIN_EMAIL: "bad" }, { optional: true })).rejects.toThrow(/ADMIN_EMAIL/);
    expect(await db.user.count()).toBe(0);
  });
});

describe("ensureAdmin with ADMIN_PASSWORD (the Railway variable is the admin password)", () => {
  it("creates the account with that password", async () => {
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "initial-pass" }, { optional: true });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await bcrypt.compare("initial-pass", user.password)).toBe(true);
    expect(user.role).toBe(R.ADMIN);
  });

  it("accepts a 6-character password, the minimum", async () => {
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "abc123" }, { optional: true });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await bcrypt.compare("abc123", user.password)).toBe(true);
  });

  it("re-applies the variable on a later start-up, so changing it changes the password", async () => {
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "first-pass" }, { optional: true });
    expect(await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "second-pass" }, { optional: true })).toBe("updated");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await bcrypt.compare("second-pass", user.password)).toBe(true);
    expect(await bcrypt.compare("first-pass", user.password)).toBe(false);
  });

  it("does not rewrite the hash when the password is already the variable's value", async () => {
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "same-pass" }, { optional: true });
    const before = (await db.user.findUniqueOrThrow({ where: { email } })).password;
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "same-pass" }, { optional: true });
    expect((await db.user.findUniqueOrThrow({ where: { email } })).password).toBe(before);
  });

  it("promotes an existing customer with that email and sets the variable's password", async () => {
    await db.user.create({ data: { email, password: await bcrypt.hash("customer-pw", 10), nom: "A", prenom: "B", role: R.CLIENT } });
    await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "owner-pass" }, { optional: true });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe(R.ADMIN);
    expect(await bcrypt.compare("owner-pass", user.password)).toBe(true);
  });

  it("start-up ignores a password that is too short and still creates the account from the email", async () => {
    expect(await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "tiny" }, { optional: true })).toBe("created");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await bcrypt.compare("tiny", user.password)).toBe(false);
    expect(user.role).toBe(R.ADMIN);
  });

  it("start-up ignores a password longer than bcrypt can read", async () => {
    const tooLong = "x".repeat(73);
    expect(await ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: tooLong }, { optional: true })).toBe("created");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await bcrypt.compare(tooLong, user.password)).toBe(false);
  });

  it("a manual run rejects a bad password loudly and writes nothing", async () => {
    await expect(ensureAdmin(db, { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "short" })).rejects.toThrow(/6 to 72 characters/);
    expect(await db.user.count()).toBe(0);
  });
});
