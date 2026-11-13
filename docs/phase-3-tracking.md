# Phase 3: customer tracking page and driver GPS

Builds on [phase 1](phase-1-order-workflow.md) and [phase 2](phase-2-delivery-workflow.md).
Everything below is our modification of Megashop (MIT).

## What was added

| Feature | Where |
|---|---|
| `position_livraison` table (GPS points, migration `driver_positions`) | `prisma/schema.prisma` |
| Driver reports position; only the assigned driver, only while the order is out for delivery, max one point per 2 s | `lib/services/trackingService.ts` `recordDriverLocation` |
| Customer tracking data: status, timeline, driver first name, latest point (only while out for delivery) | `getTracking` |
| `POST /api/delivery/orders/:id/location` (driver), `GET /api/orders/:id/tracking` (owner or admin, `Cache-Control: no-store`) | `app/api/...` |
| Customer tracking page with progress steps, timeline, Leaflet/OpenStreetMap map, polling every 5 s | `app/(portal)/client/orders/[orderId]/track/page.tsx`, `components/tracking/TrackingMap.tsx` |
| "Suivre" link on the customer order list | `components/portal/client/orderspage/OrderTable.tsx` |
| Driver location sharing (button, browser permission prompt, stop button) | `components/tracking/LocationSharer.tsx` |

## Privacy and access control (explain these in the defense)

- **Consent:** nothing is requested until the driver presses "Partager ma position"; the browser then asks for permission. The driver can stop at any time.
- **Purpose limit:** positions are accepted only while the order is `EN_LIVRAISON`, and only for the order assigned to that driver. After delivery the server refuses new points and the API stops returning the last one.
- **Who can see it:** the customer who owns the order, and the admin. Another customer gets 403.
- **Minimal exposure:** the customer sees only the driver's first name, never the driver's id, email or phone.
- **Abuse limits:** coordinates are range-checked (lat within 90, lon within 180, finite numbers) and reports are throttled (HTTP 429).
- **Same answer for "not yours" and "does not exist"** on the driver endpoint, so order ids cannot be probed.

## Verification

- `npm test`: unit and integration tests for the tracking service and routes (see `tests/tracking.test.ts`).
- `tests/live/tracking-flow.mjs`: 21 checks against the running app (pre-pickup refusal, role isolation, throttling,
  latest-point behaviour, privacy of driver data, location hidden after delivery, page guards).
- `tests/live/delivery-flow.mjs`: regression of the phase 2 flow.

## Known limits

- **Polling, not push:** the customer page refreshes every 5 s. Real push (SSE or Socket.IO) is a possible upgrade, but Vercel
  serverless cannot hold persistent connections, so it would need a small separate service.
- **Browser GPS only:** a web page can only report position while it is open and the screen is on. Reliable background tracking
  would need a native app. Say this plainly in the report.
- **Stored points:** rows stay in the database after delivery (not exposed by the API). A retention or purge job is future work.
- **Map tiles** come from the public OpenStreetMap server, which is fine for a demo but not for heavy production use.
- **No route or ETA estimate;** the map shows the last reported position only.
- **Map and geolocation not exercised in a real browser:** the page compiles and serves (HTTP 200), the API behaviour is tested,
  but nobody has watched the map move on a phone yet.
