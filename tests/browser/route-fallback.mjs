// A straight-line estimate must never look like road navigation: no "Next turn", a clear notice, and the road
// route shown only when the routing service really answered.
import { check, finish, launch, open, orderOnTheRoad, sleep, api } from "./lib.mjs";

const { id, admin, driver, client } = await orderOnTheRoad();
await api("POST", `/api/delivery/orders/${id}/location`, driver, { latitude: 8.8418, longitude: 7.8736, accuracy: 12 });
const browser = await launch({ webgl: true });

const estimate = { data: { available: true, kind: "estimate", fallbackReason: "unreachable", geometry: [[7.8736, 8.8418], [7.879, 8.852]], distanceMetres: 1700, durationSeconds: 400, source: "estimate" } };
const road = { data: { available: true, kind: "road", geometry: [[7.8736, 8.8418], [7.8765, 8.847], [7.879, 8.852]], distanceMetres: 1700, durationSeconds: 240, source: "route", nextStep: { instruction: "Turn left onto Market Road", distanceMetres: 400 } } };
const body = (page) => page.locator("body").innerText();

for (const [label, plan, isRoad] of [["routing unavailable (estimate)", estimate, false], ["routing available (road)", road, true]]) {
  // the owner's page
  const a = await open(browser, admin, `/admin/deliveries/${id}/track`);
  await a.page.route("**/api/orders/*/route", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) }));
  await sleep(11000);
  const at = await body(a.page);
  check(`${label}, owner: turn instruction shown only for a road route`, /Next turn/i.test(at) === isRoad);
  check(`${label}, owner: straight-line notice shown only for an estimate`, /straight-line/i.test(at) === !isRoad);
  check(`${label}, owner: map marked with the route kind`, (await a.page.locator(`[data-route-kind="${isRoad ? "road" : "estimate"}"]`).count()) > 0);
  check(`${label}, owner: no crash`, a.errors.length === 0, a.errors[0] ?? "");
  await a.ctx.close();
  // the driver's page
  const d = await open(browser, driver, "/driver/deliveries", { geolocation: { latitude: 8.8418, longitude: 7.8736, accuracy: 10 } });
  await d.page.route("**/api/orders/*/route", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) }));
  await sleep(13000);
  const dt = await body(d.page);
  check(`${label}, driver: turn instruction shown only for a road route`, /Next turn/i.test(dt) === isRoad);
  check(`${label}, driver: straight-line notice shown only for an estimate`, /straight-line/i.test(dt) === !isRoad);
  check(`${label}, driver: no crash`, d.errors.length === 0, d.errors[0] ?? "");
  await d.ctx.close();
  // the customer's page: line and time, never turns
  const c = await open(browser, client, `/client/orders/${id}/track`);
  await c.page.route("**/api/orders/*/route", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) }));
  await sleep(11000);
  check(`${label}, customer: never shown turn-by-turn instructions`, !/Next turn/i.test(await body(c.page)));
  await c.ctx.close();
}

// The real server with no routing service reachable (this machine cannot reach one): must say estimate.
const real = await api("GET", `/api/orders/${id}/route`, driver);
check("the real route endpoint answers an estimate (not road directions) when routing is unreachable", real.body?.data?.kind === "estimate" && real.body.data.nextStep === undefined, JSON.stringify(real.body?.data?.kind));

await browser.close();
finish();
