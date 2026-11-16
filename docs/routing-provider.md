# Road routing: provider evaluation and recommendation

TrackBot asks a routing service for (a) the road line from the delivery person to the customer's spot, (b) the time
left, and (c) turn-by-turn directions for the delivery person and the owner. Code: `lib/config/routing.ts`,
`lib/services/etaService.ts`, `lib/services/routeService.ts`.

## What changed in P0

- The provider is configurable (`ROUTING_PROVIDER` = `osrm` | `mapbox` | `none`, `ROUTING_BASE_URL`, `ROUTING_API_KEY`).
- **The public OSRM demo server is refused in production** unless `ROUTING_ALLOW_PUBLIC_DEMO=true`. Its usage policy
  forbids production use, has no uptime guarantee and rate-limits. The app logs a startup warning when no usable provider exists.
- When routing is unavailable (not configured, unreachable, bad answer) the app shows a **straight-line estimate**:
  dotted grey line, an "estimate" label on the time, a notice saying it is not a road route, and **no turn-by-turn
  directions to anyone**. Only a real road route shows "Next turn". Customers never see turns.

## Request volume (what you pay for)

The route is recomputed at most every 8 s while a delivery is on the road and a viewer has the page open
(server-side cache shared by all viewers), plus a time-left refresh every 12 s. Roughly 240 route requests for a
20-minute delivery. Ten deliveries at once for an hour: about 7,200 requests. (P1's shared-per-order watcher and
position-aware refresh will reduce this; those are not part of P0.)

## Options

Figures are from the providers' public pages at the time of research and **must be re-checked before purchase**.

| Option | Cost | Limits | Licensing | Reliability / fit |
|---|---|---|---|---|
| Public OSRM demo (`router.project-osrm.org`) | free | rate limited, no SLA | **not for production use** | fine for development only |
| **Self-hosted OSRM** (Nigeria extract from Geofabrik, OSM data) | one small VM/container (RAM for the extract, about 1–2 GB for Nigeria) plus upkeep | none except your hardware | Software BSD-2; data ODbL (attribute OpenStreetMap) | you own uptime; no per-request cost; OSM road coverage in Nigeria is uneven, so test Keffi routes |
| Mapbox Directions | about 100,000 requests/month free, then about $2 per 1,000 | 300 requests/min default | commercial use allowed on the paid terms; confirm the terms on using results with non-Mapbox maps (we draw on MapLibre with Esri imagery) | managed, good uptime; best choice to pilot without running servers |
| OpenRouteService (hosted) | free tier with daily quotas | strict daily limits | free tier is not for heavy commercial use | self-hosting is possible but heavier than OSRM |
| GraphHopper | free for non-commercial | commercial plan required | commercial licence | capable; cost for commercial use |
| Google Routes/Directions | about $5 per 1,000 after a monthly free allowance | high | its terms require showing results on a Google map | excellent data, but incompatible with our MapLibre/Esri display and the most expensive |

## Recommendation

1. **Pilot (Keffi, a few deliveries a day): Mapbox Directions** with a server-side token
   (`ROUTING_PROVIDER=mapbox`, `ROUTING_API_KEY=...`). About 240 requests per delivery means roughly 400 deliveries a month
   fit the free allowance. No server to run, and it can be switched off by a variable.
2. **Production at scale: self-hosted OSRM** on the same Railway project or a small VM, built from the Geofabrik Nigeria
   extract and refreshed monthly (`ROUTING_PROVIDER=osrm`, `ROUTING_BASE_URL=https://<your host>`). No per-request cost,
   no third-party quota, data licence is simple (ODbL attribution is already shown on the map).
3. Keep the straight-line estimate as the last resort. It is clearly labelled and never gives turns.

Before relying on any provider: route a set of real Keffi addresses and compare with what a driver knows (some local
roads and landmarks are missing from OSM), confirm the provider's current pricing and terms in writing, and set an
alert on the provider's quota.

## Operating it

- `ROUTING_PROVIDER=none` switches road routing off without a deploy; the app keeps working with estimates.
- Switching provider is a configuration change; no code or database change.
- If the provider fails mid-delivery, viewers drop to the labelled estimate on the next refresh and return to the road
  route when it recovers.
