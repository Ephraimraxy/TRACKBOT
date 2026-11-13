# Phase 1: order workflow, stock integrity, status history

Base: Megashop (MIT, Lyes Mersel) at commit `b28ffb02b4cb2278dd431337949f974ebb543209`.
Everything below is our modification.

## What changed and why

| Problem found in the base | Change | Where |
|---|---|---|
| Checkout created address, order and payment as separate writes (orphan rows on failure) | One database transaction | `lib/services/orderService.ts` `createOrder` |
| Stock never checked or reduced (overselling) | Conditional decrement `WHERE qte_stock >= qty` inside the transaction; safe under concurrent orders | same |
| Status was a bare overwrite, any value to any value | Lifecycle rules + role rules | `lib/orders/workflow.ts` |
| No status history | Append-only `historique_statut_commande` table, written in the same transaction as each change | `prisma/schema.prisma`, migration `20261027095949_...` |
| Cancelled orders kept stock reserved | Cancelling returns stock | `changeOrderStatus` |
| No delivery role | `LIVREUR` added to `UserRole` (assignment and driver endpoints come in Phase 2) | schema, `workflow.ts` |
| Quantity of 99999 crashed with a 500 (numeric overflow) | Validation: 1 to 99 per line | `lib/validations/order.ts` |

## Order lifecycle

```
EN_COURS (Pending) -> EN_PREPARATION (Processing) -> EXPEDIEE (Shipped)
   -> EN_LIVRAISON (Out for delivery) -> LIVREE (Delivered)
Cancel (ANNULEE) is allowed until the order is out for delivery.
```

Admin may perform every legal step. A delivery person may perform only
`EXPEDIEE -> EN_LIVRAISON` and `EN_LIVRAISON -> LIVREE`, and only on an order assigned to them.

## New or changed API

- `POST /api/orders`: 201 created, 400 bad input, 403 wrong user, 409 insufficient stock.
- `PATCH /api/orders/:id/status`: admin only. 200, 400, 403, 404, 409 (illegal transition).
- `GET /api/orders/:id/history`: admin or the owning customer. 401, 403, 404.

## Tests

`npm test` runs 37 tests against a separate database (`megashop_test`, created and migrated
automatically; the setup refuses any database name that does not contain "test").
Authentication is mocked in route tests; services, routes and the database are real.
Coverage: workflow rules, transactional checkout, stock races, status transitions,
role permissions, history access control.

## Known limits (stated honestly)

- Payment remains a simulated always-valid record (payment gateways are out of scope).
- The cart lives in browser state (Redux); the server cart API is a placeholder.
- The admin UI uses the new workflow module but has not yet been exercised in a browser.
