// When the chosen satellite provider refuses us (key over its limit or invalid), the map switches to free Esri pictures
// by itself instead of going blank, in the 3D map and in the flat 2D map.
// Needs the app started WITH a (fake) key:  NEXT_PUBLIC_MAPBOX_TOKEN=pk.fake npm run dev   (run: npm run test:browser:imagery)
import { check, finish, launch, open, orderOnTheRoad, sleep } from "./lib.mjs";

const { id, client, driver } = await orderOnTheRoad();
await (await fetch(`${process.env.BASE_URL ?? "http://localhost:3000"}/api/delivery/orders/${id}/location`, { method: "POST", headers: { "content-type": "application/json", cookie: driver.cookie }, body: JSON.stringify({ latitude: 8.8418, longitude: 7.8736, accuracy: 9 }) })).text();

for (const webgl of [true, false]) {
  const label = webgl ? "3D map" : "2D map";
  const browser = await launch({ webgl });
  const c = await open(browser, client, `/client/orders/${id}/track`);
  const asked = { mapbox: 0, esri: 0 };
  // The key is refused: every Mapbox tile answers 401 (3D) or fails (2D).
  await c.ctx.route(/api\.mapbox\.com/, (route) => {
    asked.mapbox++;
    return webgl ? route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Not Authorized"}' }) : route.abort();
  });
  await c.ctx.route(/arcgisonline\.com/, (route) => {
    asked.esri++;
    return route.abort(); // this sandbox has no internet: what matters is that the page ASKS Esri
  });
  await c.page.reload({ waitUntil: "domcontentloaded" });
  await c.page.waitForSelector(`[data-map-engine="${webgl ? "webgl" : "2d"}"]`, { timeout: 60000 });
  await sleep(12000);
  check(`${label}: the page tried the configured provider first`, asked.mapbox > 0, JSON.stringify(asked));
  check(`${label}: after it was refused, the page switched to Esri pictures`, asked.esri > 0, JSON.stringify(asked));
  check(`${label}: still the same map, no crash, no uncaught error`, (await c.page.locator(`[data-map-engine="${webgl ? "webgl" : "2d"}"]`).count()) > 0 && c.errors.length === 0, c.errors[0] ?? "");
  await browser.close();
}
finish();
