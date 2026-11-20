import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET as list } from "@/app/api/admin/payment-issues/route";
import { PATCH as resolve } from "@/app/api/admin/payment-issues/[id]/route";
import { executeTool, toolSpecsFor } from "@/lib/chatbot/tools";
import { buildSystemPrompt } from "@/lib/chatbot/engine";
import { orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

const mocked = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const login = (u: { id: string; role: R } | null) => mocked.mockResolvedValue(u ? { user: { id: u.id, role: u.role } } : null);
const get = () => new NextRequest("http://localhost/api/admin/payment-issues?status=open");
const patch = (note?: string) => new NextRequest("http://localhost/api/admin/payment-issues/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });

beforeEach(async () => {
  await resetDb();
  mocked.mockReset();
});
afterAll(() => db.$disconnect());

async function withIssue() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin);
  const issue = await db.paymentIssue.create({ data: { commandeId: orderId, kind: "AMOUNT_MISMATCH", reference: "TB-test-1", amountPaidKobo: 200_000, expectedKobo: 150_000, currency: "NGN", note: "Paystack reports ₦2,000 paid for an order of ₦1,500: an OVERPAYMENT." } });
  return { ...w, orderId, issue };
}

describe("payment issue endpoints", () => {
  it("401 for visitors, 403 for customers and delivery people, 200 for the owner", async () => {
    const w = await withIssue();
    login(null);
    expect((await list(get())).status).toBe(401);
    expect((await resolve(patch(), { params: Promise.resolve({ id: w.issue.id }) })).status).toBe(401);
    for (const u of [{ id: w.client.id, role: R.CLIENT }, { id: w.driver.id, role: R.LIVREUR }]) {
      login(u);
      expect((await list(get())).status).toBe(403);
      expect((await resolve(patch(), { params: Promise.resolve({ id: w.issue.id }) })).status).toBe(403);
    }
    login({ id: w.admin.id, role: R.ADMIN });
    const res = await list(get());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it("the owner resolves an issue with a note; an unknown id is 404", async () => {
    const w = await withIssue();
    login({ id: w.admin.id, role: R.ADMIN });
    expect((await resolve(patch("refunded"), { params: Promise.resolve({ id: w.issue.id }) })).status).toBe(200);
    expect((await db.paymentIssue.findUniqueOrThrow({ where: { id: w.issue.id } })).resolutionNote).toBe("refunded");
    expect((await resolve(patch(), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});

describe("the assistant and payment issues", () => {
  it("tells the owner about them, in naira, and refuses everyone else", async () => {
    const w = await withIssue();
    const r = await executeTool(db, { userId: w.admin.id, role: R.ADMIN }, "payment_issues", {});
    expect(r.output).toMatchObject({ count: 1 });
    expect((r.output.issues as { kind: string; amountPaid: number; orderTotal: number }[])[0]).toMatchObject({ kind: "wrong amount", amountPaid: 2000, orderTotal: 1500 });
    expect((await executeTool(db, { userId: w.client.id, role: R.CLIENT }, "payment_issues", {})).output).toEqual({ error: "ADMIN_ONLY" });
    expect((await executeTool(db, { userId: w.driver.id, role: R.LIVREUR }, "payment_issues", {})).output).toEqual({ error: "ADMIN_ONLY" });
    expect((await executeTool(db, { userId: null, role: null }, "payment_issues", {})).output).toEqual({ error: "LOGIN_REQUIRED" });
    expect(toolSpecsFor(R.ADMIN).map((t) => t.name)).toContain("payment_issues");
    expect(toolSpecsFor(R.CLIENT).map((t) => t.name)).not.toContain("payment_issues");
    expect(buildSystemPrompt("en", R.CLIENT)).not.toContain("payment_issues");
    expect(buildSystemPrompt("en", R.ADMIN)).toContain("payment_issues");
  });
});
