// Regression test: the map must never crash the page.
//
// Found in the delivery-intelligence audit: a route arriving while the map was still being created called
// map.getSource() before MapLibre had a style, which threw, and React replaced the WHOLE page (including the
// delivery person's "Confirm delivery" button) with "Application error". It happened when the driver page was
// opened during a delivery, with the phone moving.
import { api, check, finish, launch, open, crashed, orderOnTheRoad, sleep } from "./lib.mjs";

const browser = await launch({ webgl: true });
const { id, client, admin, driver } = await orderOnTheRoad();
await api("POST", `/api/delivery/orders/${id}/location`, driver, { latitude: 8.8418, longitude: 7.8736, accuracy: 12 });

// A route that arrives immediately, i.e. as early as possible after the map is created.
const road = { data: { available: true, kind: "road", geometry: [[7.8736, 8.8418], [7.8765, 8.847], [7.879, 8.852]], distanceMetres: 1700, durationSeconds: 240, source: "route", nextStep: { instruction: "Turn left onto Market Road", distanceMetres: 400 } } };

async function driverPageSurvives(round) {
  const { ctx, page, errors } = await open(browser, driver, "/driver/deliveries", { geolocation: { latitude: 8.84, longitude: 7.87, accuracy: 10 } });
  await page.route("**/api/orders/*/route", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(road) }));
  for (let i = 1; i <= 14; i++) { await ctx.setGeolocation({ latitude: 8.84 + i * 0.0005, longitude: 7.87, accuracy: 10 }); await sleep(1000); }
  const ok = !(await crashed(page)) && errors.length === 0;
  check(`driver page, load ${round}: no crash and no uncaught error while the phone moves`, ok, errors[0] ?? "");
  check(`driver page, load ${round}: Confirm delivery is still on screen`, (await page.getByRole("button", { name: "Confirm delivery" }).count()) > 0);
  await ctx.close();
}
for (let round = 1; round <= 3; round++) await driverPageSurvives(round);

for (const [name, who, path] of [["customer tracking page", client, `/client/orders/${id}/track`], ["owner watch-live page", admin, `/admin/deliveries/${id}/track`]]) {
  const { ctx, page, errors } = await open(browser, who, path);
  await page.route("**/api/orders/*/route", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(road) }));
  await sleep(2000);
  for (let i = 0; i < 4; i++) { await api("POST", `/api/delivery/orders/${id}/location`, driver, { latitude: 8.845 + i * 0.001, longitude: 7.875, accuracy: 10 }); await sleep(2600); }
  check(`${name}: no crash and no uncaught error while positions and routes arrive`, !(await crashed(page)) && errors.length === 0, errors[0] ?? "");
  await ctx.close();
}

await browser.close();
finish();
