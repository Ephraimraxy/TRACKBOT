# Payments the owner must look at

An order is marked **Paid** only when Paystack reports a successful transaction in **NGN** for **exactly the order total**
(`lib/services/paymentService.ts`). Everything else is recorded, the owner is told, and nothing is guessed.

| Case | What the system does | What the owner does |
|---|---|---|
| **Underpayment** or **overpayment** (or another currency) | the order is NOT marked paid; an issue "Wrong amount" is recorded with both amounts and whether it is over or under; the owner and the customer get a notification | collect the difference or refund in the Paystack dashboard, then **Mark resolved** |
| **Paid twice** (the customer started a second attempt and both were paid) | the first payment marks the order paid; the second is recorded as "Paid twice" | refund the second payment in Paystack, then resolve |
| **Dispute** (chargeback), Paystack event `charge.dispute.create` | recorded as an open "Dispute"; the owner is notified | answer the dispute in the Paystack dashboard before its deadline, then resolve. `charge.dispute.resolve` closes it automatically with Paystack's outcome |
| **Refund**, Paystack event `refund.processed` | recorded as an already-resolved "Refund" and announced | nothing to do |
| **Payment fails or is abandoned** | marked failed or left waiting; the customer can pay again (each attempt has its own reference) | nothing |

Each issue is stored once per (Paystack reference, kind), so Paystack retrying a webhook never creates duplicates.

## Where
- Owner page: **Payments to look at** (`/admin/payment-issues`, link on the Deliveries page). API: `GET /api/admin/payment-issues?status=open|resolved`, `PATCH /api/admin/payment-issues/{id}` (owner only; customers, delivery people and visitors get 403/401).
- Owner notifications link to that page. The assistant answers payment questions for the owner with the `payment_issues` tool.
- Database: table `incident_paiement` (migration `20261120100000_payment_issues`, additive).

## Setting up Paystack
In the Paystack dashboard, Settings, API Keys & Webhooks, the webhook URL is `https://<your-site>/api/payments/paystack/webhook`
(already needed for payments). Paystack sends dispute and refund events to the same address; no new setting is needed.

## Limits (be honest about them)
- The system **does not move money**: refunds and dispute answers are done in the Paystack dashboard.
- The dispute and refund event shapes follow Paystack's documentation and are read defensively, but they have **not been tested against real Paystack events**. Trigger a test dispute or refund in Paystack's test mode before relying on them.
- A customer cannot normally choose the amount on Paystack's page, so wrong amounts should be rare; the check protects against a changed price between checkout and payment, tampering and unexpected channels.
- Nothing yet reconciles Paystack's transaction list against orders automatically: a payment whose webhook never arrives is only caught when the customer returns to the site or the owner checks Paystack.
