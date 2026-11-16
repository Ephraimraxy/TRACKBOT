// P2: the owner's replay and analytics, in a real browser against the running app; and who may open them.
import { execFileSync } from "node:child_process";
import { api, check, finish, launch, login, open, orderOnTheRoad, sleep } from "./lib.mjs";

const { id, admin, driver, client } = await orderOnTheRoad();
const psql = (sql) => execFileSync("psql", [(process.env.DATABASE_URL ?? "").split("?")[0], "-Atqc", sql]).toString().trim();
// A 20-minute drive of 40 points with a 4-minute GPS gap in the middle, started an hour ago.
psql(`update historique_statut_commande set date = now() - interval '1 hour' where commande_id = '${id}' and nouveau_statut = 'EN_LIVRAISON'`);
const start = Date.now() - 30 * 60_000;
const rows = [];
for (let i = 0; i < 40; i++) {
  const at = start + i * 30_000 + (i >= 20 ? 240_000 : 0);
  rows.push(`('rp${id.slice(-6)}${i}', '${id}', '${driver.id}', 8.8418, ${7.8736 + i * 0.0002}, 9, to_timestamp(${at / 1000}), to_timestamp(${at / 1000}), false)`);
}
psql(`insert into position_livraison (id, commande_id, livreur_id, latitude, longitude, precision, date, received_at, backfilled) values ${rows.join(",")}`);
await api("PATCH", `/api/delivery/orders/${id}/status`, driver, { statut: "LIVREE" });

// who may open the report
check("anonymous cannot read the report (401)", (await api("GET", `/api/admin/deliveries/${id}/report`, null)).status === 401);
check("the customer cannot read the report (403)", (await api("GET", `/api/admin/deliveries/${id}/report`, client)).status === 403);
check("the delivery person cannot read the report (403)", (await api("GET", `/api/admin/deliveries/${id}/report`, driver)).status === 403);
check("customer and driver cannot read analytics (403)", (await api("GET", "/api/admin/delivery-analytics", client)).status === 403 && (await api("GET", "/api/admin/delivery-analytics", driver)).status === 403);
const rep = await api("GET", `/api/admin/deliveries/${id}/report`, admin);
check("the owner gets the report with the gap found", rep.status === 200 && rep.body.data.points.length === 40 && rep.body.data.findings.some((f) => f.kind === "gps_gap"), JSON.stringify(rep.body?.data?.findings));
const an = await api("GET", "/api/admin/delivery-analytics?days=7", admin);
check("the owner gets analytics including this driver", an.status === 200 && an.body.data.drivers.some((d) => d.driverId === driver.id), JSON.stringify(an.body).slice(0, 200));

for (const webgl of [true, false]) {
  const browser = await launch({ webgl });
  const label = webgl ? "3D map" : "2D map (no WebGL)";
  const a = await open(browser, admin, `/admin/deliveries/${id}/replay`);
  await a.page.waitForSelector('[data-testid="replay"]', { timeout: 60000 });
  const engine = await a.page.waitForSelector(`[data-map-engine="${webgl ? "webgl" : "2d"}"]`, { timeout: 30000 }).then(() => true, () => false);
  check(`${label}: replay page uses the right engine`, engine);
  const t1 = await a.page.locator('[data-testid="replay-time"]').innerText();
  await a.page.locator('[data-testid="replay-slider"]').fill("30");
  const t2 = await a.page.locator('[data-testid="replay-time"]').innerText();
  check(`${label}: moving the slider changes the replay time`, t1 !== t2, `${t1} -> ${t2}`);
  check(`${label}: the trail on the map grows with the slider`, (await a.page.locator('[data-trail-points="31"]').count()) > 0);
  await a.page.locator('[data-testid="replay-slider"]').fill("0");
  await a.page.locator('[data-testid="replay-play"]').click();
  await sleep(2500);
  const moved = Number(await a.page.locator('[data-testid="replay-slider"]').inputValue());
  check(`${label}: play advances the replay by itself`, moved > 0, `index=${moved}`);
  check(`${label}: the GPS gap is listed in plain words`, /GPS went quiet/.test(await a.page.locator('[data-testid="findings"]').innerText()));
  check(`${label}: no crash, no uncaught error`, a.errors.length === 0, a.errors[0] ?? "");
  await a.ctx.close();
  if (webgl) {
    const p = await open(browser, admin, "/admin/delivery-analytics");
    await p.page.waitForSelector('[data-testid="analytics"] table', { timeout: 60000 });
    check("analytics page lists the driver", (await p.page.locator('[data-testid="analytics"]').innerText()).includes(an.body.data.drivers.find((d) => d.driverId === driver.id).name));
    await p.ctx.close();
  }
  await browser.close();
}
// the replay page is for the owner: a customer opening it sees no data
const cb = await launch({ webgl: false });
const c = await open(cb, client, `/admin/deliveries/${id}/replay`);
await sleep(4000);
check("a customer opening the replay page sees no movement data", (await c.page.locator('[data-testid="replay"]').count()) === 0);
await cb.close();
finish();
