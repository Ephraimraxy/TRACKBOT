#!/usr/bin/env bash
# Migration recovery drill. Runs entirely on SCRATCH databases that it creates and drops; it never touches the
# database named in DATABASE_URL except to read a copy of it as realistic sample data.
#
#   DATABASE_URL=postgresql://user:pass@host:port/somedb  bash scripts/migration-drill.sh
#
# The user in DATABASE_URL must be allowed to CREATE DATABASE. See docs/runbooks/database-migrations.md.
set -uo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?set DATABASE_URL (any database on the server to drill on; used only to find the server)}"
SRC="${DATABASE_URL%%\?*}"
BASE="${SRC%/*}"
SRC_DB="${SRC##*/}"
ADMIN="$BASE/postgres"
ID="drill_$$"
A="$BASE/${ID}_a"; B="$BASE/${ID}_b"; C="$BASE/${ID}_c"
WORK="$(mktemp -d)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
q()    { psql "$1" -Atqc "$2"; }
prisma_with() { # prisma_with <db-url> <schema-dir> <args...>
  local url="$1" dir="$2"; shift 2
  DATABASE_URL="$url" DATABASE_DIRECT_URL="$url" npx --no-install prisma "$@" --schema "$dir/schema.prisma"
}
cleanup() {
  for d in a b c; do psql "$ADMIN" -qc "DROP DATABASE IF EXISTS ${ID}_$d WITH (FORCE)" >/dev/null 2>&1; done
  rm -rf "$WORK"
}
trap cleanup EXIT
for d in a b c; do psql "$ADMIN" -qc "CREATE DATABASE ${ID}_$d" || { echo "cannot create scratch database"; exit 2; }; done

# A private copy of the schema + migrations, so the drill can add a deliberately broken migration without touching the repo.
mkdir -p "$WORK/p"; cp prisma/schema.prisma "$WORK/p/"; cp -r prisma/migrations "$WORK/p/migrations"
LATEST="$(ls prisma/migrations | grep -v migration_lock | sort | tail -1)"

echo "== 1. Fresh database: every migration applies, in order"
prisma_with "$A" "$WORK/p" migrate deploy >"$WORK/1.log" 2>&1; RC=$?
check "migrate deploy succeeds on an empty database" "[ $RC -eq 0 ] && grep -q 'successfully applied' $WORK/1.log"
check "migrate status says the database is up to date" "prisma_with '$A' '$WORK/p' migrate status 2>&1 | grep -q 'Database schema is up to date'"

echo "== 2. Upgrade with real data: a production-like copy, one migration behind"
if pg_dump -Fc "$SRC" -f "$WORK/sample.dump" 2>/dev/null; then
  pg_restore --no-owner -d "$B" "$WORK/sample.dump" >/dev/null 2>&1
  q "$B" "ALTER TABLE livraison DROP COLUMN IF EXISTS route_planifiee" >/dev/null
  q "$B" "DELETE FROM _prisma_migrations WHERE migration_name = '$LATEST'" >/dev/null
  BEFORE="$(q "$B" "SELECT (SELECT count(*) FROM commande)||'/'||(SELECT count(*) FROM position_livraison)||'/'||(SELECT count(*) FROM livraison)||'/'||(SELECT count(*) FROM \"user\")")"
  prisma_with "$B" "$WORK/p" migrate deploy >"$WORK/2.log" 2>&1; RC=$?
  AFTER="$(q "$B" "SELECT (SELECT count(*) FROM commande)||'/'||(SELECT count(*) FROM position_livraison)||'/'||(SELECT count(*) FROM livraison)||'/'||(SELECT count(*) FROM \"user\")")"
  check "the pending migration ($LATEST) is applied" "[ $RC -eq 0 ] && grep -q '$LATEST' $WORK/2.log"
  check "no rows lost (orders/positions/deliveries/users before $BEFORE, after $AFTER)" "[ -n '$BEFORE' ] && [ '$BEFORE' = '$AFTER' ]"
  check "the new column exists, is nullable and has no default, so the previous app version (which never writes it) keeps working" "[ \"\$(q '$B' \"SELECT is_nullable||'/'||coalesce(column_default,'none') FROM information_schema.columns WHERE table_name='livraison' AND column_name='route_planifiee'\")\" = 'YES/none' ]"
  check "existing deliveries read back with the new column empty" "[ \"\$(q '$B' 'SELECT count(*) FROM livraison WHERE route_planifiee IS NULL')\" = \"\$(q '$B' 'SELECT count(*) FROM livraison')\" ]"
else
  echo "SKIP  could not read a sample copy of $SRC_DB"
fi

echo "== 3. A migration that fails half way, and how to recover"
BAD="20991231000000_drill_broken"
mkdir -p "$WORK/p/migrations/$BAD"
cat >"$WORK/p/migrations/$BAD/migration.sql" <<'SQL'
ALTER TABLE "livraison" ADD COLUMN "drill_marker" INTEGER;
ALTER TABLE "table_that_does_not_exist" ADD COLUMN "x" INTEGER;
SQL
prisma_with "$A" "$WORK/p" migrate deploy >"$WORK/3a.log" 2>&1; RC=$?
check "the broken migration is rejected (non-zero exit)" "[ $RC -ne 0 ]"
check "its failure is recorded as a failed migration" "[ \"\$(q '$A' \"SELECT count(*) FROM _prisma_migrations WHERE migration_name='$BAD' AND finished_at IS NULL AND rolled_back_at IS NULL\")\" = '1' ]"
check "the half-applied column was NOT left behind (Postgres ran the file as one transaction)" "[ \"\$(q '$A' \"SELECT count(*) FROM information_schema.columns WHERE table_name='livraison' AND column_name='drill_marker'\")\" = '0' ]"
prisma_with "$A" "$WORK/p" migrate deploy >"$WORK/3b.log" 2>&1
check "a second deploy refuses to continue (P3009): this is the crash loop on Railway" "grep -q 'P3009' $WORK/3b.log"
prisma_with "$A" "$WORK/p" migrate resolve --rolled-back "$BAD" >"$WORK/3c.log" 2>&1
check "'migrate resolve --rolled-back' clears the failed state" "grep -qi 'rolled back' $WORK/3c.log"
cat >"$WORK/p/migrations/$BAD/migration.sql" <<'SQL'
ALTER TABLE "livraison" ADD COLUMN "drill_marker" INTEGER;
SQL
prisma_with "$A" "$WORK/p" migrate deploy >"$WORK/3d.log" 2>&1
check "after fixing the migration, deploy completes" "grep -q 'successfully applied' $WORK/3d.log"
check "the fixed migration's column now exists" "[ \"\$(q '$A' \"SELECT count(*) FROM information_schema.columns WHERE table_name='livraison' AND column_name='drill_marker'\")\" = '1' ]"

echo "== 4. Backup and restore (the real rollback)"
pg_dump -Fc "$A" -f "$WORK/a.dump"
q "$A" "SELECT 1" >/dev/null
pg_restore --no-owner -d "$C" "$WORK/a.dump" >/dev/null 2>&1
check "a restored backup has the same migrations as the original" "[ \"\$(q '$C' 'SELECT count(*) FROM _prisma_migrations')\" = \"\$(q '$A' 'SELECT count(*) FROM _prisma_migrations')\" ]"
q "$A" "CREATE TABLE after_backup(id int)" >/dev/null
check "changes made after the backup are not in it (restoring loses them: this is the limit of rollback)" "[ \"\$(q '$C' \"SELECT count(*) FROM information_schema.tables WHERE table_name='after_backup'\")\" = '0' ]"
check "migrate status on the restored copy is consistent" "prisma_with '$C' '$WORK/p' migrate status 2>&1 | grep -q 'Database schema is up to date'"

echo "== 5. What cannot be undone"
q "$A" "ALTER TYPE \"CommandeStatut\" ADD VALUE IF NOT EXISTS 'DRILL_VALUE'" >/dev/null 2>&1
check "an enum value can be added" "[ \"\$(q '$A' \"SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='CommandeStatut' AND e.enumlabel='DRILL_VALUE'\")\" = '1' ]"
check "an enum value cannot be dropped (Postgres has no such command), so adding one is a one-way step" "! psql '$A' -qc \"ALTER TYPE \\\"CommandeStatut\\\" DROP VALUE 'DRILL_VALUE'\""

echo
echo "drill finished: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
