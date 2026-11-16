# P1: reliability and accuracy of live delivery tracking

What P1 changed, how it behaves, and what is still open. Tests: `tests/trackingHub.test.ts`, `tests/locationBackfill.test.ts`,
`tests/deviation.test.ts`, `tests/locationQueue.test.ts`, `tests/buildingPick.test.ts`, `tests/coverage.test.ts`,
and the browser/HTTP checks `tests/browser/p1-server.mjs` and `tests/browser/offline-queue.mjs`.

## 1. One shared watcher per order, and stream limits
`lib/services/trackingHub.ts`, `lib/services/streamLimits.ts`, `app/api/orders/[orderId]/live/route.ts`.
- Before: every open page ran its own database check every 1.5 s. Now one watcher per order serves every viewer; the full
  tracking picture is built once per change.
- A viewer must still pass the normal permission check (`getTracking` as themselves) before joining the shared watcher.
- Limits: 5 streams per person (`TRACKING_MAX_STREAMS_PER_USER`), 500 per server process (`TRACKING_MAX_STREAMS_TOTAL`);
  beyond that the answer is 429 with `Retry-After`. Slots are freed when a stream ends or the browser disconnects.
- Limit: counts are per server process. With several instances each enforces its own limit.

## 2. GPS capture times, and offline queue with backfill
`lib/services/trackingService.ts`, `lib/tracking/locationQueue.ts`, `components/tracking/LocationSharer.tsx`,
migration `20261115110000_position_capture_times`.
- Every point keeps `date` (when the phone captured the fix; all ordering uses it), `received_at` (when the server stored
  it) and `backfilled` (arrived late).
- A point more than 30 s old when it arrives, or older than the newest point already held, is history: it fills in the trail
  with its original time, never becomes the current position, never moves the estimate and sends no reminders.
- Refused: capture time more than 60 s in the future, older than 6 h, or before the delivery started. A small clock drift is
  treated as "now". The same point sent twice is stored once. One bad point in a batch does not stop the rest.
- The phone keeps unsent points in local storage (per order, up to 500, 6 h), shows how many are waiting, and sends them oldest
  first in batches of 100 when the connection returns. Tracking ending (403/409) empties the queue.
- Authorisation is unchanged: only the assigned delivery person, only while the order is out for delivery.

## 3. Accuracy-aware, sustained deviation
`lib/services/deviation.ts`, `lib/services/routeService.ts`.
- "Rerouted" is shown only when the newest usable fixes, at least 3 in a row spanning at least 15 s, are all farther from the
  planned road than 60 m plus each fix's own accuracy. Fixes worse than ±100 m are ignored in both directions. One stray fix,
  or a quick swerve, changes nothing. Late (backfilled) points are not used. Straight-line estimates never "reroute".

## 4. Correct building identification
`lib/maps/buildingPick.ts`, `lib/maps/destination.ts`.
- The red building is now the one whose outline contains the pin (point in polygon, holes respected, innermost wins). A pin
  just outside every building takes the nearest wall within 12 m. Farther than that nothing is highlighted: no highlight is
  better than the wrong house. Before, the first building under a small box around the pin was taken.

## 5. Imagery coverage test for Keffi
`scripts/imagery-coverage.ts` (`npx tsx scripts/imagery-coverage.ts --provider esri|mapbox|maptiler|osm --report docs/imagery-keffi.md`).
- Samples a grid of tiles over Keffi at zooms 15 to 20, scores detail, spots repeated "no imagery" placeholders, and writes a
  per-zoom table. **It has not been run against real imagery**: this build environment has no internet access to the tile
  servers (every tile reads "unreachable", exit code 3). Run it from a connected machine, for each candidate provider, and look
  at a few tiles by eye.

## Not done in P1
- Per-instance limits are not shared across servers (needs Redis or similar).
- The queue only helps while the page stays open or is reopened on the same phone. Background tracking when the screen is
  off is P3 (native Android service).
- Late points are stored and shown on the trail, but the viewer's trail refreshes on the next live point or stream event.
- New interface text has English only; translations are not added yet (the app falls back to English).
