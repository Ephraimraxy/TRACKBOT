// P1, against the running app over real HTTP: late (queued) GPS points, and live-stream limits and sharing.
import { execFileSync } from "node:child_process";
import { api, BASE, check, finish, orderOnTheRoad, sleep } from "./lib.mjs";

const { id, client, admin, driver } = await orderOnTheRoad();
// The delivery "started" an hour ago, so points captured minutes ago belong to it (points from before it are refused).
const dbUrl = (process.env.DATABASE_URL ?? "").split("?")[0];
execFileSync("psql", [dbUrl, "-qc", `update historique_statut_commande set date = now() - interval '1 hour' where commande_id = '${id}' and nouveau_statut = 'EN_LIVRAISON'`]);
const now = Date.now();
const post = (body) => api("POST", `/api/delivery/orders/${id}/location`, driver, body);
const track = async () => (await api("GET", `/api/orders/${id}/tracking`, client)).body.data;

// --- a live point, then a queued batch captured earlier (with one bad point in it) ---
const live = await post({ latitude: 8.845, longitude: 7.875, accuracy: 8, capturedAt: now - 1000 });
check("a live point is accepted with its capture time", live.status === 201 && live.body.data.backfilled === false, JSON.stringify(live.body));
const batch = await post({
  points: [
    { latitude: 8.842, longitude: 7.872, accuracy: 9, capturedAt: now - 120_000 },
    { latitude: 8.841, longitude: 7.871, accuracy: 9, capturedAt: now - 180_000 },
    { latitude: 8.9, longitude: 7.9, accuracy: 9, capturedAt: now + 3_600_000 }, // an hour in the future: refused
  ],
});
const r = batch.body?.data?.results ?? [];
check("the queued batch saves the good points as history and refuses the impossible one", batch.status === 201 && r[0]?.status === "saved" && r[0].backfilled && r[1]?.backfilled && r[2]?.status === "rejected", JSON.stringify(r));
const again = await post({ points: [{ latitude: 8.842, longitude: 7.872, accuracy: 9, capturedAt: now - 120_000 }] });
check("sending the same queued point again stores nothing new", again.body?.data?.results?.[0]?.status === "duplicate", JSON.stringify(again.body));
const t = await track();
check("the customer still sees the LIVE point as the current position", Math.abs(t.location.latitude - 8.845) < 1e-9, JSON.stringify(t.location));
check("the trail is in capture order, with the late points filled in before it", t.trail.map((p) => p.latitude).join() === "8.841,8.842,8.845", t.trail.map((p) => p.latitude).join());
const early = await post({ points: [{ latitude: 8.84, longitude: 7.87, capturedAt: now - 2 * 3600_000 }] });
check("a point captured before the delivery started is refused", early.body?.data?.results?.[0]?.status === "rejected");
check("a customer cannot post points (403)", (await api("POST", `/api/delivery/orders/${id}/location`, client, { points: [{ latitude: 1, longitude: 1 }] })).status === 403);
check("anonymous cannot post points (401)", (await api("POST", `/api/delivery/orders/${id}/location`, null, { points: [{ latitude: 1, longitude: 1 }] })).status === 401);

// --- stream limits ---
const open = async (who) => {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/orders/${id}/live`, { headers: { cookie: who.cookie }, signal: ac.signal });
  return { res, ac };
};
const streams = [];
for (let i = 0; i < 5; i++) streams.push(await open(client));
check("a person may hold 5 live streams", streams.every((s) => s.res.status === 200), streams.map((s) => s.res.status).join());
const sixth = await open(client);
check("the 6th is refused with 429 and a clear message", sixth.res.status === 429 && /Too many/i.test((await sixth.res.json()).error));
check("another person (the owner) is not affected by the customer's limit", (await (async () => { const a = await open(admin); const ok = a.res.status === 200; a.ac.abort(); return ok; })()));
streams[0].ac.abort();
await sleep(500);
const seventh = await open(client);
check("closing a stream frees a slot", seventh.res.status === 200, String(seventh.res.status));
check("a stranger gets nothing from a stream and does not use a slot (401 without a session)", (await fetch(`${BASE}/api/orders/${id}/live`)).status === 401);

// --- every stream shares one watcher and still gets the update ---
const reads = [streams[1], streams[2], seventh].map(async ({ res }) => {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  const until = Date.now() + 9000;
  while (Date.now() < until) {
    const { value, done } = await Promise.race([reader.read(), sleep(9000).then(() => ({ done: true }))]);
    if (done) break;
    text += dec.decode(value);
    if (text.includes("8.8466")) return true;
  }
  return false;
});
await sleep(1000);
await post({ latitude: 8.8466, longitude: 7.8755, accuracy: 8, capturedAt: Date.now() });
const got = await Promise.all(reads);
check("three open streams on one order all receive the new position", got.every(Boolean), got.join());

for (const s of [...streams, seventh]) s.ac.abort();
finish();
