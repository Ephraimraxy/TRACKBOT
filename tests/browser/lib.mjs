// Shared helpers for the browser-level tests (tests/browser/*.mjs).
//
// They drive a RUNNING app (npm run dev, or npm run build && npm start) seeded with `npm run seed:demo`, in a real
// Chromium (Playwright), so they catch problems that unit tests cannot: map loading races, missing WebGL, crashes
// that replace a whole page with "Application error".
//
//   BASE_URL=http://localhost:3000 node tests/browser/map-race.mjs
//
// Chromium comes from the Playwright install (`npx playwright install chromium`) or from PLAYWRIGHT_CHROMIUM_PATH.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = process.env.TEST_PASSWORD ?? "Test1234!";

let failures = 0;
export const check = (name, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
};
export const finish = () => {
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  const raw = r.headers.getSetCookie();
  const cookie = raw.map((c) => c.split(";")[0]).join("; ");
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json();
  return { cookie, id: s.user?.id, raw };
}
export async function api(method, path, who, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", cookie: who?.cookie ?? "" }, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
export const cookiesFor = (who) => who.raw.map((c) => { const [kv] = c.split(";"); const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: BASE }; });

const WEBGL_ON = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const WEBGL_OFF = ["--disable-gpu", "--disable-webgl", "--disable-3d-apis", "--disable-webgl2"];

/** A Chromium with WebGL (software-rendered if there is no GPU) or without it, like an old or locked-down phone. */
export async function launch({ webgl }) {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  return chromium.launch({ args: webgl ? WEBGL_ON : WEBGL_OFF, ...(exe ? { executablePath: exe } : {}) });
}

/** An order the shop has shipped, assigned and the delivery person has started, with the customer's spot pinned. */
export async function orderOnTheRoad({ pinned = true } = {}) {
  const client = await login("client@email.com");
  const admin = await login("admin@email.com");
  const driver = await login("livreur1@email.com");
  const prods = (await api("GET", "/api/products?pageSize=1")).body.data;
  const address = { rue: "12 Market Road", ville: "Keffi", wilaya: "Nasarawa", codePostal: "961101", repere: "Blue gate opposite the mosque", ...(pinned ? { latitude: 8.852, longitude: 7.879 } : {}) };
  const id = (await api("POST", "/api/orders", client, { userId: client.id, addresse: address, produits: [{ produitId: prods[0].id, quantite: 1 }] })).body.data.id;
  for (const s of ["EN_PREPARATION", "EXPEDIEE"]) await api("PATCH", `/api/orders/${id}/status`, admin, { statut: s });
  await api("POST", `/api/orders/${id}/assign`, admin, { driverId: driver.id });
  await api("PATCH", `/api/delivery/orders/${id}/status`, driver, { statut: "EN_LIVRAISON" });
  return { id, client, admin, driver };
}

/** Open a page as `who` and collect every uncaught error, so a test can say "nothing crashed". */
export async function open(browser, who, path, { geolocation, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, ...(geolocation ? { geolocation, permissions: ["geolocation"] } : {}) });
  await ctx.addCookies(cookiesFor(who));
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 2).join(" <- ").slice(0, 200)));
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  return { ctx, page, errors };
}
export const crashed = async (page) => (await page.locator("body").innerText().catch(() => "")).includes("Application error");
