// The map must work without WebGL (old or locked-down phones, some browsers): a flat 2D map takes over, the page
// stays usable, and nothing crashes. With WebGL the 3D map is used.
import { api, check, finish, launch, open, crashed, orderOnTheRoad, sleep } from "./lib.mjs";

const { id, client, admin, driver } = await orderOnTheRoad();
await api("POST", `/api/delivery/orders/${id}/location`, driver, { latitude: 8.8418, longitude: 7.8736, accuracy: 12 });

async function engineOf(page) {
  await page.waitForSelector("[data-map-engine]", { timeout: 45000 }).catch(() => {});
  return page.locator("[data-map-engine]").first().getAttribute("data-map-engine").catch(() => null);
}

for (const [label, webgl, expected] of [["WebGL available", true, "webgl"], ["WebGL unavailable", false, "2d"]]) {
  const browser = await launch({ webgl });
  for (const [name, who, path, geo] of [
    ["customer tracking page", client, `/client/orders/${id}/track`, false],
    ["owner watch-live page", admin, `/admin/deliveries/${id}/track`, false],
    ["driver page", driver, "/driver/deliveries", true],
  ]) {
    const { ctx, page, errors } = await open(browser, who, path, geo ? { geolocation: { latitude: 8.84, longitude: 7.87, accuracy: 10 } } : {});
    const engine = await engineOf(page);
    await sleep(3000);
    check(`${label}, ${name}: uses the ${expected === "webgl" ? "3D" : "flat 2D"} map`, engine === expected, `(engine=${engine})`);
    check(`${label}, ${name}: no crash, no uncaught error`, !(await crashed(page)) && errors.length === 0, errors[0] ?? "");
    if (expected === "2d") {
      check(`${label}, ${name}: the flat map shows the delivery person's marker`, (await page.locator(".tb-driver").count()) > 0);
      check(`${label}, ${name}: the flat map has zoom controls`, (await page.locator(".leaflet-control-zoom").count()) > 0);
    } else {
      check(`${label}, ${name}: a WebGL canvas is drawn`, (await page.locator("canvas.maplibregl-canvas").count()) > 0);
    }
    if (name === "driver page") check(`${label}, driver page: Confirm delivery is on screen`, (await page.getByRole("button", { name: "Confirm delivery" }).count()) > 0);
    await ctx.close();
  }
  await browser.close();
}
finish();
