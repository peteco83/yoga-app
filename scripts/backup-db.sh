#!/usr/bin/env bash
# Dumps the production database to ./backups and prunes old dumps.
# Run it from cron on the NAS, e.g. every night at 03:30:
#   30 3 * * * cd /volume1/docker/yoga-app && ./scripts/backup-db.sh >> /volume1/docker/yoga-app/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.production.yml
KEEP_DAYS=${KEEP_DAYS:-14}

if [ ! -f .env ]; then
  echo "missing .env - copy .env.example to .env and fill it in" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

mkdir -p backups
file="backups/${POSTGRES_DB:-yoga_app}-$(date +%Y%m%d-%H%M%S).sql.gz"

# --clean --if-exists makes the dump restorable with a plain `psql -f`.
if ! docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip -9 >"$file"; then
  rm -f "$file"
  echo "pg_dump failed" >&2
  exit 1
fi

if [ ! -s "$file" ]; then
  rm -f "$file"
  echo "pg_dump produced an empty file" >&2
  exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') backup written: $file ($(du -h "$file" | cut -f1))"

find backups -name '*.sql.gz' -type f -mtime +"$KEEP_DAYS" -print -delete
