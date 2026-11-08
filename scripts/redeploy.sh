#!/usr/bin/env bash
# Deploys the current checkout on the NAS: pull, rebuild, restart, clean up.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.production.yml

if [ ! -f .env ]; then
  echo "missing .env - copy .env.example to .env and fill it in" >&2
  exit 1
fi

echo "== fetching latest code =="
git pull --ff-only

echo "== building images =="
docker compose -f "$COMPOSE_FILE" build

echo "== starting stack =="
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "== pruning dangling images =="
docker image prune -f >/dev/null

echo "== status =="
docker compose -f "$COMPOSE_FILE" ps
