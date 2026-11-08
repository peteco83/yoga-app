#!/usr/bin/env bash
# Sets the password of an admin account.
#
# Use it right after the first deploy: database/init.sql seeds admin/admin123,
# which must never stay on a public site.
#
#   ./scripts/set-admin-password.sh            # changes "admin"
#   ./scripts/set-admin-password.sh my-user    # changes another account
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.production.yml
USERNAME=${1:-admin}

if [ ! -f .env ]; then
  echo "missing .env - copy .env.example to .env and fill it in" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

read -r -s -p "New password for '$USERNAME': " PASSWORD
echo
read -r -s -p "Repeat password: " PASSWORD2
echo

if [ "$PASSWORD" != "$PASSWORD2" ]; then
  echo "passwords do not match" >&2
  exit 1
fi

if [ "${#PASSWORD}" -lt 12 ]; then
  echo "use at least 12 characters" >&2
  exit 1
fi

# pgcrypto's gen_salt('bf', 10) emits the same $2a$ bcrypt hashes that the Go
# API verifies, so no extra tooling is needed on the NAS.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v username="$USERNAME" -v password="$PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE admins
   SET password_hash = crypt(:'password', gen_salt('bf', 10))
 WHERE username = :'username';
SQL

# `psql -c` does not interpolate :'variables', so feed the check on stdin.
updated=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -tA -v username="$USERNAME" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - <<'SQL'
SELECT count(*) FROM admins WHERE username = :'username';
SQL
)

if [ "${updated:-0}" = "0" ]; then
  echo "no admin named '$USERNAME' - existing accounts:" >&2
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, username FROM admins" >&2
  exit 1
fi

echo "password updated for '$USERNAME' (log in at /login to confirm)"
