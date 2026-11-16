// Inside the TrackBot Driver app (a WebView with window.TrackBotNative), the page must hand sharing to the app and NOT
// share from the browser too: no duplicate GPS posts, no browser geolocation. Simulated with a mock bridge.
import { check, finish, launch, open, orderOnTheRoad, sleep } from "./lib.mjs";
import { execFileSync } from "node:child_process";

const { id, driver } = await orderOnTheRoad();
const db = (sql) => execFileSync("psql", [(process.env.DATABASE_URL ?? "").split("?")[0], "-Atqc", sql]).toString().trim();
db(`update commande set statut = 'LIVREE' where statut = 'EN_LIVRAISON' and id <> '${id}' and id in (select commande_id from livraison where livreur_id = '${driver.id}')`);

const browser = await launch({ webgl: true });
const mock = () => {
  window.__calls = [];
  let running = false;
  let ended = false;
  window.__fix = { latitude: 8.8418, longitude: 7.8736, accuracy: 7, capturedAt: Date.now() };
  window.TrackBotNative = {
    isAvailable: () => true,
    version: () => "1.0.0",
    start: (orderId) => { window.__calls.push(["start", orderId]); running = true; return "started"; },
    stop: () => { window.__calls.push(["stop"]); running = false; },
    status: () => JSON.stringify({ tracking: running && !ended, orderId: running ? "x" : null, queued: window.__queued ?? 0, signedOut: window.__signedOut === true, lastSentAt: Date.now(), lastFix: { ...window.__fix, capturedAt: window.__fix.capturedAt } }),
  };
  window.__endByServer = () => { ended = true; };
  // count any browser-side GPS use or posts to the location endpoint
  window.__posts = 0;
  const f = window.fetch;
  window.fetch = (u, o) => { if (String(u).includes("/location") && o?.method === "POST") window.__posts++; return f(u, o); };
  const g = navigator.geolocation;
  window.__watches = 0;
  if (g) { const w = g.watchPosition.bind(g); g.watchPosition = (...a) => { window.__watches++; return w(...a); }; }
};
const d = await open(browser, driver, "/driver/deliveries", { geolocation: { latitude: 8.8418, longitude: 7.8736, accuracy: 10 }, init: mock });
await d.page.waitForSelector('[data-testid="native-active"]', { timeout: 60000 }).catch(() => undefined);
await sleep(5000);
const calls = await d.page.evaluate(() => window.__calls);
check("the page hands the delivery to the app (start with this order's id)", calls.some((c) => c[0] === "start" && c[1] === id), JSON.stringify(calls));
check("the page says sharing runs in the app, with the screen off", (await d.page.locator('[data-testid="native-active"]').count()) > 0);
check("the browser does NOT also share: no watchPosition, no location posts from the page", (await d.page.evaluate(() => [window.__watches, window.__posts])).join() === "0,0", String(await d.page.evaluate(() => [window.__watches, window.__posts])));
check("the page shows the app's last fix", (await d.page.locator("text=Last sent").count()) > 0);

await d.page.evaluate(() => { window.__queued = 4; window.__signedOut = true; });
await sleep(4000);
check("points waiting in the app are shown", (await d.page.locator('[data-testid="queued-points"]').count()) > 0);
check("a signed-out app is shown clearly", (await d.page.locator('[data-testid="native-signed-out"]').count()) > 0);

await d.page.evaluate(() => window.__endByServer());
await sleep(4500);
check("when the app stops (the server ended tracking) the page notices", (await d.page.locator("text=Tracking has ended for this order.").count()) > 0);
check("no crash, no uncaught error", d.errors.length === 0, d.errors[0] ?? "");
await d.ctx.close();

// an ordinary browser (no bridge) still shares by itself
const e = await open(browser, driver, "/driver/deliveries", { geolocation: { latitude: 8.8418, longitude: 7.8736, accuracy: 10 }, init: () => { window.__posts = 0; const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes("/location") && o?.method === "POST") window.__posts++; return f(u, o); }; } });
await sleep(7000);
check("without the app, the browser shares as before", (await e.page.evaluate(() => window.__posts)) >= 1);
await e.ctx.close();
await browser.close();
finish();
