// The delivery person's phone loses signal mid-delivery: points are kept with their capture times and sent, as
// history, when the connection returns. Real browser, real server, real database.
import { execFileSync } from "node:child_process";
import { check, finish, launch, open, orderOnTheRoad, sleep } from "./lib.mjs";

const { id, driver, client } = await orderOnTheRoad();
const db = (sql) => execFileSync("psql", [(process.env.DATABASE_URL ?? "").split("?")[0], "-Atc", sql]).toString().trim();
// Leftovers from other test runs would put several deliveries on the driver's page: keep only this one on the road.
db(`update commande set statut = 'LIVREE' where statut = 'EN_LIVRAISON' and id <> '${id}' and id in (select commande_id from livraison where livreur_id = '${driver.id}')`);
const browser = await launch({ webgl: true });
const d = await open(browser, driver, "/driver/deliveries", { geolocation: { latitude: 8.8418, longitude: 7.8736, accuracy: 10 } });
await sleep(6000);
const live = Number(db(`select count(*) from position_livraison where commande_id='${id}'`));
check("while online, points reach the server", live >= 1, `points=${live}`);

await d.ctx.setOffline(true);
for (let i = 1; i <= 6; i++) {
  await d.ctx.setGeolocation({ latitude: 8.8418 + i * 0.0006, longitude: 7.8736 + i * 0.0006, accuracy: 10 });
  await sleep(9000);
}
const queued = await d.page.locator('[data-testid="queued-points"]').count();
check("offline: the page says points are saved and will be sent", queued > 0);
const during = Number(db(`select count(*) from position_livraison where commande_id='${id}'`));
check("offline: nothing new reached the server", during === live, `before=${live} during=${during}`);

await d.ctx.setOffline(false);
await sleep(9000);
const late = db(`select count(*) filter (where backfilled), count(*) filter (where backfilled and received_at - date > interval '25 seconds') from position_livraison where commande_id='${id}'`).split("|").map(Number);
check("back online: the kept points arrived as history", late[0] >= 2, `backfilled=${late[0]}`);
check("they keep their ORIGINAL capture times (captured well before they were received)", late[1] >= 1, `old=${late[1]}`);
const current = db(`select latitude from position_livraison where commande_id='${id}' order by date desc limit 1`);
check("the current position is the newest capture, not the last one received", Number(current) >= 8.8418 + 5 * 0.0006, current);
check("the kept-points notice clears once sent", (await d.page.locator('[data-testid="queued-points"]').count()) === 0);
check("no crash, no uncaught error", d.errors.length === 0, d.errors[0] ?? "");
await browser.close();
finish();
