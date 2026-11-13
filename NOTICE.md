# Notice and credits

TrackBot builds on the following work. Their licences require that this notice and the licence text be kept.

## Megashop (MIT)

- Source: https://github.com/lyes-mersel/megashop
- Copyright (c) 2025 Lyes Mersel and contributors
- Licence: MIT (see [LICENSE](LICENSE))
- Provided: the storefront, authentication (NextAuth), admin and vendor portals, and the Prisma data model
  that this project extends. Based on commit `b28ffb02b4cb2278dd431337949f974ebb543209`.

## Other open-source components

- Leaflet (BSD-2-Clause): https://leafletjs.com
- OpenStreetMap data and tiles (ODbL): https://www.openstreetmap.org/copyright
- Next.js, React, Prisma, NextAuth, Tailwind CSS, Radix UI, Vitest and the other packages in `package.json`,
  each under its own licence.

## What was added by this project

Order lifecycle with status history and stock-safe checkout, delivery assignment and driver screens, driver GPS
reporting and the customer tracking page, the TrackBot assistant (tools, AI provider fallback, rule-based mode),
FAQ management, Cloudflare R2 image storage, Resend email, deployment configuration, and the automated tests.
