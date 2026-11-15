# Database migration and recovery runbook

Applies to: TrackBot on Railway (PostgreSQL + Prisma 6). Written for P0; every claim marked **(drilled)** is exercised
by `scripts/migration-drill.sh` on scratch databases (last run: 18 of 18 checks passed).

## 1. How migrations reach production

- Migrations are SQL files in `prisma/migrations/<timestamp>_<name>/migration.sql`, committed with the code.
- `npm start` runs `prisma migrate deploy` **before** `next start` (`package.json`). If a migration fails the process
  exits non-zero, nothing is served from the half-updated version, and Railway retries (`restartPolicyMaxRetries = 3`).
- `migrate deploy` never generates or edits migrations and never resets data. It only applies pending files, in order.
- Postgres runs each migration file as one transaction, so a file that fails part-way leaves **no partial change** (drilled).

**Preferred (controlled) deployment** instead of relying on app start:

1. Back up (section 2).
2. Run migrations as a separate step against production, before releasing the new code:
   `DATABASE_URL=<prod direct url> DATABASE_DIRECT_URL=<same> npx prisma migrate deploy` (from a trusted machine or a
   one-off Railway command).
3. Confirm `npx prisma migrate status` reports "Database schema is up to date".
4. Release the code. The start-up `migrate deploy` is then a no-op.

Migrations in this repo are written so the **previous** application version keeps working against the **new** schema
(new columns are nullable with no default). That is what makes step 2 safe before step 4, and makes rollback of the
code alone (section 5) possible. Keep it that way: add, backfill, then (in a later release) remove.

## 2. Before every production migration: back up

```
pg_dump -Fc "$PROD_DIRECT_URL" -f trackbot-$(date +%Y%m%d-%H%M).dump
pg_restore --list trackbot-*.dump | head     # the dump is readable
```

- Also take a Railway volume/database snapshot if the plan offers it; keep the `.dump` off Railway.
- Restore-test the dump on a scratch database (section 6) at least once per release that contains a migration.
- Know the time of the backup: everything written after it is lost if you restore it (section 5).

## 3. Rehearse on a scratch database

`npm run drill:migrations` (needs `DATABASE_URL` pointing at any local or scratch Postgres user allowed to
`CREATE DATABASE`). It creates throw-away databases, drops them afterwards, and checks:

1. all migrations apply to an empty database and `migrate status` is clean;
2. a production-like copy that is one migration behind upgrades without losing rows, and the new column is nullable with no default;
3. a deliberately broken migration is rejected, recorded as failed, leaves no partial change, blocks later deploys with
   **P3009**, is cleared with `migrate resolve --rolled-back`, and a corrected file then deploys;
4. a `pg_dump` backup restores to a consistent copy, and changes made after the backup are absent from it;
5. a Postgres enum value can be added but not dropped.

Run it before releasing any migration, against a copy of production data when you can.

## 4. If a migration fails in production

Symptoms: the deploy fails; logs show `P3018`/`P3009`; Railway restarts and fails again (crash loop); `migrate status`
says a migration "failed to apply".

1. **Stop the loop.** Pause automatic restarts or scale the service to zero so it does not hammer the database.
2. **Look.** `npx prisma migrate status` against production; read the error in the deploy log. Check what actually
   changed: because each file is one transaction, normally nothing did. Verify with `\d <table>` rather than assuming.
3. **Decide.**
   - *The change did not apply (normal):* fix the migration file in a new commit (or fix the data that blocked it), then
     `npx prisma migrate resolve --rolled-back <migration_name>` and `npx prisma migrate deploy`. (drilled)
   - *The change did apply but was not recorded (e.g. a connection dropped after commit):* check the objects exist, then
     `npx prisma migrate resolve --applied <migration_name>`.
   - *Unsure, or data is damaged:* do not guess. Restore the backup (section 5, option B).
4. Redeploy the application, watch `/api/health`, run a smoke test: sign in, open an order, open a live-tracking page.
5. Write down what happened and add a drill step for it.

Never edit a migration that has already been applied anywhere. Never run `prisma migrate reset` or `db push` against production.

## 5. Rolling back, and its limits

There are no automatic "down" migrations. Three options, in order of preference:

**A. Roll back the code only.** Redeploy the previous release and leave the schema as it is. Safe when the migration only
added nullable columns or tables (as `20261115100000_eta_source` does): the old code ignores them (drilled: existing rows
read back with the new column empty). This loses nothing.

**B. Restore the backup.** Restore into a new database, check it (section 6), point `DATABASE_URL` at it. This is the
only way to undo a destructive change, and it **loses every write made after the backup** (new orders, payments,
location points, status changes). Payments made in that window must be reconciled by hand against the Paystack
dashboard before and after. (drilled: a table created after the backup is absent from the restored copy)

**C. Write a forward "undo" migration.** Drop the column or table in a new migration. Only after the code that used it is gone.

Limits to know in advance:

- `ALTER TYPE ... ADD VALUE` (new enum values such as a new order status) **cannot be undone**: Postgres has no
  `DROP VALUE`. Treat every enum addition as permanent, and make sure the previous code tolerates an unknown value
  before releasing it. (drilled)
- Dropping or narrowing a column, or changing a type, destroys data. Do it only in a later release, after a verified backup.
- A restore rewinds *all* tables, not just the one you migrated.
- Backups made while payments are being processed can be internally inconsistent with Paystack; always reconcile.
- Prisma's `_prisma_migrations` table must match the files in the repo. After a restore, run `migrate status`.

## 6. Restore test (scratch)

```
createdb trackbot_restore_test
pg_restore --no-owner -d trackbot_restore_test trackbot-<stamp>.dump
DATABASE_URL=... DATABASE_DIRECT_URL=... npx prisma migrate status
psql trackbot_restore_test -c "select count(*) from commande"
dropdb trackbot_restore_test
```

## 7. Release checklist

- [ ] `npm test` and `npm run test:browser` pass; `npm run drill:migrations` passes.
- [ ] Migration is additive (nullable / default / new table) or the destructive step is justified in the PR.
- [ ] Backup taken, size and `pg_restore --list` checked, time noted.
- [ ] Migrate first, release code second (section 1).
- [ ] Smoke test after release; keep the backup until the next release is stable.
