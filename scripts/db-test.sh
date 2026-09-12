#!/usr/bin/env bash
#
# Applies every migration to a throwaway local Postgres and runs the
# authorization suite against it. Seconds, rather than a round trip through CI.
#
#   ./scripts/db-test.sh
#
# Needs a Postgres server package installed locally (the binaries, not a running
# service): on Debian or Ubuntu, `apt-get install postgresql-16`. The cluster it
# makes lives under /tmp and is rebuilt from nothing on every run, so there is
# no state to go stale and nothing to clean up.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${POSTIT_TEST_PGDIR:-/tmp/postit-pgtest}"
PORT="${POSTIT_TEST_PGPORT:-55432}"
PGBIN="${POSTIT_TEST_PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

if [ ! -x "${PGBIN:-}/initdb" ]; then
  echo "No Postgres binaries found. Set POSTIT_TEST_PGBIN, or install postgresql." >&2
  exit 1
fi

# initdb refuses to run as root, so hand the cluster to the postgres account
# when there is one and we are root.
AS=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  AS="postgres"
fi
run_pg() { if [ -n "$AS" ]; then su "$AS" -c "$1"; else bash -c "$1"; fi; }

if [ ! -s "$BASE/data/PG_VERSION" ]; then
  rm -rf "$BASE"
  mkdir -p "$BASE/data" "$BASE/sock"
  [ -n "$AS" ] && chown -R "$AS":"$AS" "$BASE"
  run_pg "$PGBIN/initdb -D $BASE/data -U postgres --auth=trust -E UTF8" >/dev/null
fi

if ! "$PGBIN/pg_isready" -h "$BASE/sock" -p "$PORT" >/dev/null 2>&1; then
  run_pg "$PGBIN/pg_ctl -D $BASE/data -o '-k $BASE/sock -p $PORT -c listen_addresses=' -l $BASE/data/log -w start" >/dev/null
fi

PSQL=(psql -h "$BASE/sock" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists postit_test;" >/dev/null 2>&1
"${PSQL[@]}" -d postgres -c "create database postit_test;" >/dev/null
# Supabase keeps pgcrypto in `extensions` and keeps it on the search path.
"${PSQL[@]}" -d postgres -c "alter database postit_test set search_path to public, extensions;" >/dev/null
"${PSQL[@]}" -d postit_test -f "$REPO/scripts/supabase-shim.sql" >/dev/null

for migration in "$REPO"/supabase/migrations/*.sql; do
  if ! "${PSQL[@]}" -d postit_test -f "$migration" > "$BASE/out.log" 2>&1; then
    echo "migration failed: $(basename "$migration")" >&2
    grep -E "ERROR" "$BASE/out.log" | head -5 >&2
    exit 1
  fi
done

if "${PSQL[@]}" -d postit_test -f "$REPO/supabase/tests/authorization.sql" > "$BASE/suite.log" 2>&1; then
  echo "authorization suite passed ($(grep -c 'NOTICE:  pass:' "$BASE/suite.log") checks)"
  exit 0
fi

echo "authorization suite FAILED" >&2
grep -E "ERROR" "$BASE/suite.log" | tail -3 >&2
echo "--- last checks to pass ---" >&2
grep 'NOTICE:  pass:' "$BASE/suite.log" | tail -3 >&2
exit 1
