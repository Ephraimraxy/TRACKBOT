# Phase 2: delivery personnel, assignment, notifications

Builds on [phase 1](phase-1-order-workflow.md). Everything below is our modification of Megashop (MIT).

## What was added

| Feature | Where |
|---|---|
| `livraison` table: one delivery person per order (migration `20261027102943_delivery_assignment`) | `prisma/schema.prisma` |
| Admin assigns / reassigns a driver (blocked once out for delivery, delivered or cancelled) | `lib/services/deliveryService.ts` `assignDriver` |
| Driver sees only their own deliveries (customer name, phone and address for assigned orders only) | `listDriverDeliveries` |
| Driver advances only `EXPEDIEE -> EN_LIVRAISON -> LIVREE`, only on orders assigned to them | `driverChangeStatus` |
| Customer notification on every status change; driver notification on assignment | `changeOrderStatus`, `assignDriver` |
| Admin delivery board and driver page | `app/(portal)/admin/deliveries`, `app/(portal)/driver/deliveries` |
| Route guard for `/driver` (role `LIVREUR`) | `middleware.ts`, `lib/constants/routes.ts` |
| Seeded delivery staff `livreur1@email.com`, `livreur2@email.com` (password = `DEFAULT_PASSWORD`) | `lib/seed/insertDrivers.ts` |

## API

| Endpoint | Who | Notes |
|---|---|---|
| `GET /api/drivers` | admin | delivery staff list |
| `GET /api/deliveries` | admin | assignable orders with current driver |
| `POST /api/orders/:id/assign` `{driverId}` | admin | 400 bad/invalid driver, 404, 409 not assignable |
| `GET /api/delivery/orders` | driver | own deliveries only |
| `PATCH /api/delivery/orders/:id/status` | driver | 403 if not assigned (same answer whether or not the order exists), 409 illegal step |

## Security decisions worth explaining

- Authorization is enforced in the service layer, not only in routes or the UI.
- An unassigned driver gets 403 for both "not yours" and "does not exist", so order ids cannot be probed.
- Drivers cannot cancel, process or ship; admins cannot use the driver endpoint (each role has its own door).

## Verification

- `npm test`: 55 tests pass (workflow rules, order service, delivery service, all routes).
- `tests/live/delivery-flow.mjs` drives the real running app (customer order, admin ship and assign,
  driver delivers, customer timeline and notifications, role isolation, page guards).
  Run: start `npm run dev`, then `node tests/live/delivery-flow.mjs`. Last run: all 26 flow checks pass;
  the 27th (notification text) had a flawed check (it read only page 1 of a paginated list) and
  was confirmed separately through the API.

## Known limits

- No GPS or live map yet (next phase). Drivers confirm by tapping a button; no proof of delivery photo.
- The driver page refreshes by polling every 10 seconds (no WebSocket).
- UI was verified to compile and to respect route guards (HTTP 200 / 307); it has not been clicked through
  in a browser by a person.
