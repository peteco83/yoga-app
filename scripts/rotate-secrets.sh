#!/usr/bin/env bash
# Rotates the two secrets that live in .env, and proves the stack still works.
#
#   ./scripts/rotate-secrets.sh              # asks what to rotate
#   ./scripts/rotate-secrets.sh both --yes   # JWT_SECRET + POSTGRES_PASSWORD
#   ./scripts/rotate-secrets.sh jwt          # ends every admin session
#   ./scripts/rotate-secrets.sh db           # new database password
#
# Any secret that has ever left the NAS (a screenshot, a chat, a copy on a
# laptop) has to be treated as burnt. JWT_SECRET is easy; POSTGRES_PASSWORD is
# the one people forget, because Postgres only reads it when the volume is
# created - afterwards the only way is ALTER USER. This script does both,
# restarts the API, checks that it reconnected, and puts everything back if it
# did not.
set -euo pipefail
# Absolute path first: the hint below survives the `cd`, and so does sudo.
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.production.yml
KEEP_BACKUPS=${KEEP_BACKUPS:-3}

usage() {
  cat <<'TXT'
usage: ./scripts/rotate-secrets.sh [jwt|db|both] [--yes]

  jwt     rotate JWT_SECRET: every admin token stops working, everybody is
          sent back to /login (the database is not touched)
  db      rotate POSTGRES_PASSWORD: rewrites .env and runs ALTER USER, because
          Postgres ignores the variable once the volume exists
  both    both of the above (the default when the script asks)
  --yes   skip the confirmation prompt, for a scripted run

.env is backed up first (.env.bak-<timestamp>, the last $KEEP_BACKUPS are kept).
Then the API is recreated and /api/health must answer 200 within 30 s; if it
does not, .env and the database password are restored and the old API is started
again. Nothing else on the NAS is changed.
TXT
}

# Read .env without `source`: a password containing & ! $ or a space is valid
# for Docker (which parses the file itself) but would break shell sourcing.
env_get() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -n 1 |
    sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" -e 's/[[:space:]]*$//'
}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

WHAT=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    jwt | db | both) WHAT=$arg ;;
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help) usage; exit 0 ;;
    *)
      echo "unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -f .env ]; then
  echo "missing .env - copy .env.example to .env and fill it in" >&2
  exit 1
fi

POSTGRES_USER=$(env_get POSTGRES_USER)
POSTGRES_DB=$(env_get POSTGRES_DB)
LAN_BIND=$(env_get LAN_BIND)
LAN_BIND=${LAN_BIND:-127.0.0.1}
LAN_PORT=$(env_get LAN_PORT)
LAN_PORT=${LAN_PORT:-5007}
# 0.0.0.0 is reachable as loopback; any other bind address is used as-is.
if [ "$LAN_BIND" = "0.0.0.0" ]; then
  LAN_BIND=127.0.0.1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed here - this script runs on the NAS, not on the Mac" >&2
  exit 1
fi

# A rotation that cannot be verified is worse than no rotation: refuse to run
# without the daemon and the database.
if ! docker info >/dev/null 2>&1; then
  cat >&2 <<EOF
cannot talk to the Docker daemon (permission denied on /var/run/docker.sock?)

  run it with sudo:      sudo $SELF ${WHAT:-both} --yes
  or join the group:     sudo usermod -aG docker "\$USER"   (then log in again)
EOF
  exit 1
fi

if [ -z "$(compose ps -q postgres 2>/dev/null)" ]; then
  echo "the postgres container is not running - start the stack first:" >&2
  echo "  docker compose -f $COMPOSE_FILE up -d" >&2
  exit 1
fi

if [ -z "$WHAT" ]; then
  cat <<'TXT'
What do you want to rotate?
  1) both: JWT_SECRET + POSTGRES_PASSWORD   (recommended)
  2) JWT_SECRET only - ends every admin session
  3) POSTGRES_PASSWORD only - new database password
TXT
  printf 'choice [1]: '
  read -r choice
  case "${choice:-1}" in
    1 | "") WHAT=both ;;
    2) WHAT=jwt ;;
    3) WHAT=db ;;
    *)
      echo "not a valid choice" >&2
      exit 2
      ;;
  esac
fi

if [ "$ASSUME_YES" = "0" ]; then
  echo
  echo "About to rotate: $WHAT"
  echo "  - the API container is recreated: a few seconds of downtime"
  if [ "$WHAT" != "db" ]; then
    echo "  - a new JWT_SECRET logs out every admin, including you"
  fi
  if [ "$WHAT" != "jwt" ]; then
    echo "  - the database password changes: ALTER USER, .env, restart"
  fi
  echo "  - .env is backed up first and restored if the check at the end fails"
  echo
  printf 'Continue? [y/N] '
  read -r answer
  case "$answer" in
    [yY] | [yY][eE][sS]) ;;
    *)
      echo "nothing was changed"
      exit 1
      ;;
  esac
fi

ROTATE_JWT=0
ROTATE_DB=0
case "$WHAT" in
  jwt) ROTATE_JWT=1 ;;
  db) ROTATE_DB=1 ;;
  both)
    ROTATE_JWT=1
    ROTATE_DB=1
    ;;
esac

OLD_JWT=$(env_get JWT_SECRET)
OLD_PW=$(env_get POSTGRES_PASSWORD)

# Rewrites one key in .env atomically and keeps the rest of the file byte for
# byte (comments, order, the tunnel token). Stale "#KEY=..." lines are dropped:
# an old secret parked in a comment is a secret waiting to be resurrected.
env_set() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp "$(pwd)/.env.new.XXXXXX")
  awk -v key="$key" -v value="$value" '
    BEGIN { written = 0; stale = 0 }
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" { print key "=" value; written = 1; next }
    $0 ~ "^[[:space:]]*#[[:space:]]*" key "[[:space:]]*=" { stale++; next }
    { print }
    END {
      if (!written) print key "=" value
      if (stale) printf("   (%d stale commented %s line(s) removed)\n", stale, key) > "/dev/stderr"
    }
  ' .env >"$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" .env
}

# Postgres only reads POSTGRES_PASSWORD when the volume is created, so from the
# second boot on the password lives in the database: ALTER USER is the only way.
# The connection uses the container's local socket, which asks for no password.
# `-f -` on stdin, not `-c`: psql -c does not interpolate :'variables'.
set_db_password() {
  compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v u="$POSTGRES_USER" -v p="$1" -f - <<'SQL'
ALTER USER :"u" WITH PASSWORD :'p';
SQL
}

# /api/health pings the database, so a 200 here means the API authenticated
# with the new password through the DATABASE_URL that Compose rebuilt from .env.
wait_for_api() {
  local i code url="http://$LAN_BIND:$LAN_PORT/api/health"
  if command -v curl >/dev/null 2>&1; then
    for i in $(seq 1 30); do
      code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$url" 2>/dev/null || true)
      if [ "$code" = "200" ]; then
        echo "   GET $url -> 200"
        return 0
      fi
      sleep 1
    done
    echo "!! $url did not answer 200 within 30s" >&2
  else
    # No curl on the host: ask the API container itself (it ships busybox wget).
    for i in $(seq 1 30); do
      if compose exec -T backend wget -q -O /dev/null http://127.0.0.1:8080/health 2>/dev/null; then
        echo "   health inside the API container -> ok (no curl on this host)"
        return 0
      fi
      sleep 1
    done
    echo "!! the API did not report healthy within 30s" >&2
  fi
  compose logs --tail=20 backend >&2 || true
  return 1
}

# Compare what the container really sees, without ever printing the secret.
check_secret_env() {
  local have
  have=$(compose exec -T backend printenv "$1" 2>/dev/null | tr -d '\r\n') || true
  if [ "$have" != "$2" ]; then
    echo "!! $1 inside the API container is not the new value" >&2
    return 1
  fi
  echo "   $1 in the container matches the new value"
}

check_password_in_url() {
  if compose exec -T backend printenv DATABASE_URL 2>/dev/null | grep -qF -- "$1"; then
    echo "   DATABASE_URL carries the new POSTGRES_PASSWORD"
    return 0
  fi
  echo "!! DATABASE_URL in the container does not contain the new password" >&2
  return 1
}

# --- backup and rollback ----------------------------------------------------

ENV_BACKUP=".env.bak-$(date +%Y%m%d-%H%M%S)"
cp .env "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP" 2>/dev/null || true
echo "== .env backed up as $ENV_BACKUP =="

DB_CHANGED=0
rollback() {
  local rc=$?
  trap - ERR
  echo "!! rotation failed (exit $rc) - restoring the previous state" >&2
  cp "$ENV_BACKUP" .env
  echo "   .env restored" >&2
  if [ "$DB_CHANGED" = "1" ] && [ -n "$OLD_PW" ]; then
    set_db_password "$OLD_PW" && echo "   database password restored" >&2
  fi
  compose up -d --no-deps --force-recreate backend >/dev/null 2>&1 || true
  echo "   API restarted with the old secrets - the site is as it was" >&2
  exit "$rc"
}
trap rollback ERR

# --- generate ---------------------------------------------------------------

NEW_JWT=""
NEW_PW=""

if [ "$ROTATE_JWT" = "1" ]; then
  NEW_JWT=$(openssl rand -base64 48 | tr -d '\n')
  # base64 of 48 bytes: 64 characters, no "/#%$&= " that .env or Compose mind.
  if [ "${#NEW_JWT}" -lt 32 ]; then
    echo "openssl returned an unusably short JWT secret" >&2
    trap - ERR
    rm -f "$ENV_BACKUP"
    exit 1
  fi
fi

if [ "$ROTATE_DB" = "1" ]; then
  # hex on purpose: "/", "#" and "%" break the connection URL Compose builds,
  # "$" is expanded by Compose, and "&" broke the older shell scripts.
  NEW_PW=$(openssl rand -hex 24)
  case "$NEW_PW" in
    "" | *[!0-9a-f]*)
      echo "unexpected characters in the generated password" >&2
      trap - ERR
      rm -f "$ENV_BACKUP"
      exit 1
      ;;
  esac
fi

# --- apply ------------------------------------------------------------------

# Database first: if ALTER USER fails, .env is still the old one and the running
# API keeps working, so a failure here costs nothing.
if [ "$ROTATE_DB" = "1" ]; then
  echo "== changing the database password (ALTER USER $POSTGRES_USER) =="
  set_db_password "$NEW_PW"
  DB_CHANGED=1
  echo "   done"
  echo "== writing the new POSTGRES_PASSWORD into .env =="
  env_set POSTGRES_PASSWORD "$NEW_PW"
fi

if [ "$ROTATE_JWT" = "1" ]; then
  echo "== writing the new JWT_SECRET into .env =="
  env_set JWT_SECRET "$NEW_JWT"
  # The old value must not survive anywhere in the file: a commented leftover is
  # a secret waiting to be resurrected.
  if [ -n "$OLD_JWT" ] && grep -qF -- "$OLD_JWT" .env; then
    echo "!! the old JWT_SECRET is still somewhere in .env" >&2
    false
  fi
fi

echo "== recreating the API =="
# --no-deps: only the API is recreated. Without it Compose also recreates the
# containers it depends on, i.e. it would restart PostgreSQL for a new .env.
if ! output=$(compose up -d --no-deps --force-recreate backend 2>&1); then
  printf '%s\n' "$output" >&2
  false
fi
echo "   yoga-api recreated; the database and nginx keep running"

echo "== checking the stack =="
wait_for_api
if [ "$ROTATE_JWT" = "1" ]; then
  check_secret_env JWT_SECRET "$NEW_JWT"
fi
if [ "$ROTATE_DB" = "1" ]; then
  check_password_in_url "$NEW_PW"
fi

trap - ERR

# Keep the last $KEEP_BACKUPS .env backups, drop the rest.
i=0
for old in $(ls -1t .env.bak-* 2>/dev/null); do
  i=$((i + 1))
  if [ "$i" -gt "$KEEP_BACKUPS" ]; then rm -f "$old"; fi
done

echo
echo "== done =="
if [ "$ROTATE_JWT" = "1" ]; then
  echo "  JWT_SECRET         new, 64 characters - every admin session is invalid now,"
  echo "                     you have to log in again at /login"
fi
if [ "$ROTATE_DB" = "1" ]; then
  echo "  POSTGRES_PASSWORD  new, ${#NEW_PW} hex characters - read it with:"
  echo "                     grep '^POSTGRES_PASSWORD=' .env"
  echo "                     DATABASE_URL is composed from it, nothing else to update"
fi
echo "  .env backup        $ENV_BACKUP"
echo "  API                healthy through $LAN_BIND:$LAN_PORT with the new settings"
