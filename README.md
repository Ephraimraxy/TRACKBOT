# TrackBot

**Development of Tracker Based Chat Bot System for Small E-Commerce Business**
BSc Computer Science final-year project, Nasarawa State University, Keffi (2026).

A web shop where customers can ask a chat assistant about products, prices and their own orders,
and follow each order from checkout to delivery, including the delivery person's live position.
It serves three kinds of user: the **shop owner (admin)**, the **customer** and the **delivery person**.

## What it does

| Role | Can do |
|---|---|
| Customer | Browse and search products, order, see every status change of an order on a tracking page (with a live map while it is out for delivery), chat with the assistant |
| Shop owner | Manage products and photos, orders and statuses, assign delivery people, manage the assistant's FAQ answers, see reports |
| Delivery person | See assigned deliveries, start and confirm delivery, share their position for the current delivery only |

The assistant (**TrackBot**) answers from the shop's real data through read-only server tools: product prices
and stock, the logged-in customer's own orders and tracking, and the owner's FAQ answers. It cannot invent a price
or an order status, and it never sees another customer's data. Without any AI key it still works in a built-in
rule-based mode; with keys it tries DeepSeek, then OpenAI, then Claude.

## Stack

Next.js 15 (App Router) and React 19, TypeScript, PostgreSQL with Prisma, NextAuth (credentials, role-based access),
Leaflet and OpenStreetMap for the map, Cloudflare R2 for images, Resend for email, Vitest for tests, Railway for hosting.

## Run it locally

You need Node.js 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL, AUTH_SECRET and any optional services
npx prisma migrate deploy     # create the tables
npm run seed                  # reference data: categories, genders, colours, sizes
npm run seed:admin            # first admin (set ADMIN_EMAIL and ADMIN_PASSWORD for this one command)
npm run dev                   # http://localhost:3000
```

For sample accounts and products while developing: `npm run seed:demo` (local only; refuses to run in production).

Everything optional degrades gracefully: without AI keys the assistant uses rule-based answers, without R2 product
photos show a placeholder, without Resend verification emails are not sent. The server prints which are missing at start-up.

## Tests

```bash
npm test                      # unit and integration tests against a separate test database
```

`tests/live/*.mjs` are end-to-end checks against a running server (see the header of each file).

## Deployment (Railway)

`railway.toml` and `npm start` apply pending database migrations and then start the server; `/api/health` is the
health check. Secrets are set as Railway variables, never committed. See `.env.example` for every variable.

## Project layout

```
app/            pages and API routes (App Router)
components/     UI components
lib/            business logic: services (orders, delivery, tracking, FAQ), chatbot, storage, config
prisma/         schema, migrations, seeds
tests/          automated tests (live/ = end-to-end scripts)
docs/           design notes for each stage of the project
```

## Project report

The full project report (Chapters One to Five, references and appendices, with the screenshots, diagrams, test results and the security review) is in [`docs/report/`](docs/report/).

## Credits and licence

This project extends **Megashop** by Lyes Mersel and contributors (MIT licence), which provided the storefront,
authentication and admin foundation. The original licence text is in [LICENSE](LICENSE) and the full credits are in
[NOTICE.md](NOTICE.md). New work in this repository (order workflow and status history, delivery and driver features,
live tracking, the chatbot, FAQ management, R2 storage, email, deployment) is by the project team.

## Known limits

- Online payment goes through Paystack (set `PAYSTACK_SECRET_KEY`); without it orders can be placed but not paid. There is no refund function, and customers cannot cancel an order themselves.
- The rate limiter is in memory (one server instance), a session keeps its role for up to 30 days, and no Content-Security-Policy header is set; see the report, Table 4.6, for the full list of known gaps.
- GPS is reported by the delivery person's browser, so it only updates while that page is open.
- Translations other than English are being added; screens not yet translated fall back to English.
