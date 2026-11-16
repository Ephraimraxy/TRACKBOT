// After "Place order" the page must go straight to a "saving / opening payment" message, never flash "Your cart is empty".
import { check, finish, launch, login, sleep, api, BASE, cookiesFor } from "./lib.mjs";

const client = await login("client@email.com");
const product = (await api("GET", "/api/products?pageSize=1")).body.data[0];
const cart = { cart: { items: [{ id: product.id, name: product.nom ?? "Product", imagePublicId: "x", price: 100, color: { id: "", name: "" }, size: { id: "", name: "" }, quantity: 1 }], totalQuantities: 1 }, totalPrice: 100, action: null };

const browser = await launch({ webgl: false });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
await ctx.addCookies(cookiesFor(client));
await ctx.addInitScript((c) => localStorage.setItem("persist:root", JSON.stringify({ carts: JSON.stringify(c), _persist: JSON.stringify({ version: 1, rehydrated: true }) })), cart);
const page = await ctx.newPage();
// Paystack's initialize call is slow (3 s), like a real one. It answers with a harmless local address.
await page.route("**/api/payments/paystack/initialize", async (route) => {
  await sleep(3000);
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorizationUrl: `${BASE}/api/health` }) });
});
await page.goto(`${BASE}/order`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector('input[name="street"]', { timeout: 60000 });
for (const [n, v] of [["street", "12 Market Road"], ["city", "Keffi"], ["wilaya", "Nasarawa"], ["postalCode", "961101"]]) await page.fill(`input[name="${n}"]`, v);

const seen = [];
const watcher = (async () => {
  for (let i = 0; i < 24; i++) {
    seen.push((await page.locator("body").innerText().catch(() => "")).slice(0, 4000));
    await sleep(150);
  }
})();
await page.getByRole("button", { name: /place order/i }).click();
await watcher;
const flashed = seen.some((t) => /cart is empty/i.test(t));
const showedSaving = seen.some((t) => /Opening the secure payment page/i.test(t));
check("no 'Your cart is empty' flash after Place order", !flashed);
check("shows 'Your order is saved… Opening the secure payment page' while waiting", showedSaving);
await sleep(4000);
console.log("URL:", page.url(), "| BODY:", (await page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\n/g, " "));
check("then goes on to the payment address", page.url().includes("/api/health"), page.url());
await browser.close();
finish();
