# P2: movement playback, deviation and GPS reports, analytics, imagery comparison

All owner-only (admin). Customers and delivery people get `403` from the report and analytics endpoints, and the pages show no data to them.

| Feature | Where |
|---|---|
| Movement playback | `/admin/deliveries/[orderId]/replay` (`components/tracking/DeliveryReplay.tsx`), data from `GET /api/admin/deliveries/[orderId]/report`. Play/pause, 1x to 60x speed, slider, late (offline-queue) points marked. Uses the same adaptive map: 3D with WebGL, flat 2D without. |
| Deviation report | The first road route of each delivery is now kept (`livraison.route_planifiee`, migration `20261115120000_planned_route_snapshot`). The report replays the same sustained-deviation rule as the live screen against it: when the driver left the road, for how long, how far. If routing was unavailable no road was kept and the report says deviation cannot be judged. |
| GPS failure report | Signal gaps (over 60 s), vague fixes (worse than ±100 m), impossible jumps (over 144 km/h, ignored in distances), late points, too few points, long stops. Plain-language findings in `lib/analytics/trackAnalysis.ts` (`findingsFor`). |
| Delivery analytics | `/admin/delivery-analytics`, `GET /api/admin/delivery-analytics?days=30`: finished deliveries, average time and distance, GPS problems, deviations, per delivery person, up to 200 recent deliveries. |
| Imagery provider comparison | `npx tsx scripts/imagery-coverage.ts --compare esri,mapbox,maptiler --report docs/imagery-compare.md` (side by side per zoom, best provider, placeholder detection). |

Tests: `tests/trackAnalysis.test.ts`, `tests/deliveryReport.test.ts`, `tests/coverage.test.ts`, and in a real browser `tests/browser/p2-replay.mjs` (access control, slider, play, 3D and 2D, findings, analytics page).

## Limits
- The imagery comparison is built and unit-tested but **has not run against real imagery**: this environment cannot reach the tile servers. Run it from a connected machine with Mapbox and MapTiler keys.
- Deliveries finished before P1/P2 have no kept road route and no late-point flags; their deviation cannot be judged.
- "Average time" is the span of recorded GPS points, not start-to-delivered clock time. A delivery with few points is counted under "too few GPS points".
- Playback shows recorded points (thinned to 4000 for very long deliveries), not an interpolated road path; speed up by the control, not by smoothing.
- **Estimate accuracy** (added later): the first estimate of each delivery is now kept (`eta_initiale_*`, migration `20261122100000_eta_initial`) and compared with the time to "Delivered" on the analytics page, road and straight-line estimates separately. Only deliveries made after that migration count. "Actual" includes the driver's stops.
- The new migration is additive (a nullable column, no default).
