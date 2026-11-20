// The owner's "Payments to look at" page in a real browser: an open issue shows, can be resolved, and customers cannot use it.
import { execFileSync } from "node:child_process";
import { api, check, finish, launch, open, orderOnTheRoad, sleep } from "./lib.mjs";

const { id, admin, client } = await orderOnTheRoad();
const psql = (sql) => execFileSync("psql", [(process.env.DATABASE_URL ?? "").split("?")[0], "-Atqc", sql]).toString().trim();
const ref = `TB-e2e-${Date.now()}`;
psql(`insert into incident_paiement (id, commande_id, kind, status, reference, amount_paid_kobo, expected_kobo, currency, note) values ('pi${Date.now()}', '${id}', 'AMOUNT_MISMATCH', 'OPEN', '${ref}', 250000, 150000, 'NGN', 'Paystack reports ₦2,500 paid for an order of ₦1,500: an OVERPAYMENT. The order was NOT marked paid.')`);

check("the customer cannot read the list (403)", (await api("GET", "/api/admin/payment-issues", client)).status === 403);
check("anonymous cannot read the list (401)", (await api("GET", "/api/admin/payment-issues", null)).status === 401);

const browser = await launch({ webgl: false });
const a = await open(browser, admin, "/admin/payment-issues");
await a.page.waitForSelector('[data-testid="payment-issue"]', { timeout: 60000 });
const text = await a.page.locator('[data-testid="payment-issues"]').innerText();
check("the owner sees the open issue with its amounts and reference", /OVERPAYMENT/.test(text) && text.includes(ref) && /₦2,500/.test(text), text.slice(0, 200));
await sleep(2000); // let the page finish loading before typing
await a.page.locator('input[placeholder^="What you did"]').first().fill("refunded ₦1,000 in Paystack");
await a.page.getByRole("button", { name: /mark resolved/i }).first().click();
await a.page.locator('[data-testid="payment-issue"]').filter({ hasText: ref }).waitFor({ state: "detached", timeout: 15000 }).catch(() => undefined);
check("after 'Mark resolved' it leaves the open list", (await a.page.locator('[data-testid="payment-issue"]').filter({ hasText: ref }).count()) === 0);
check("and the database has the owner's note", psql(`select resolution_note from incident_paiement where reference = '${ref}'`) === "refunded ₦1,000 in Paystack");
await a.page.locator('[data-testid="reconcile"]').click();
await a.page.waitForSelector('text=/not set up|Checked|No waiting payments/', { timeout: 15000 }).catch(() => undefined);
check("the owner can use 'Check waiting payments with Paystack' (answers, never crashes)", /not set up|Checked|No waiting payments/.test(await a.page.locator("body").innerText()));
check("no crash, no uncaught error", a.errors.length === 0, a.errors[0] ?? "");
await a.ctx.close();

const c = await open(browser, client, "/admin/payment-issues");
await sleep(4000);
check("a customer opening the page sees no payment data", (await c.page.locator('[data-testid="payment-issue"]').count()) === 0);
await browser.close();
finish();
