# Momkari Yoga

Website for the Momkari Yoga studio (Münchenbuchsee): a scroll-driven Angular
landing page plus a small admin area for members and contact messages.

| Part | Stack |
| --- | --- |
| `frontend/yoga-frontend` | Angular 21 (standalone, signals), Three.js + GSAP for the hero bowl and the breathing orb |
| `backend` | Go + Gin, JWT sessions, bcrypt admin login |
| `database` | PostgreSQL 15, schema seeded by `database/init.sql` |
| deploy | Docker Compose on a NAS, published with a Cloudflare Tunnel |

```
frontend (nginx :80) ──/api/*──▶ backend (Go :8080) ──▶ postgres:5432
        ▲
        └── Cloudflare Tunnel (cloudflared) ──▶ https://<your-domain.com>
```

## Local development

```bash
# database + API
docker compose up -d postgres backend

# frontend dev server on http://localhost:4200 (proxies /api to :8080)
cd frontend/yoga-frontend
npm install
npm start
```

The admin area lives at `/login` (`admin` / `admin123` on a fresh database —
development only), members at `/admin` and contact messages at `/admin/messages`.

## Production

Everything runs on the NAS and is exposed only through a Cloudflare Tunnel:

```bash
cp .env.example .env     # fill in passwords, JWT secret, tunnel token
docker compose -f docker-compose.production.yml up -d --build
```

Step-by-step runbook (DNS, tunnel, Access, backups, troubleshooting):
**[DEPLOY-NAS.md](DEPLOY-NAS.md)**.

The NAS share `docker` is mounted on this Mac at `/Volumes/docker`, so the
deployment folder is `/Volumes/docker/yoga-app` (= `/volume1/docker/yoga-app` on
the NAS). To push the current working tree there:

```bash
rsync -a --delete \
  --exclude '/.env' --exclude '/.env.bak-*' --exclude '/.git/' --exclude '/backups/' --exclude '.DS_Store' \
  --exclude '/backend/backend' --exclude '/backend/api' \
  --exclude '/frontend/yoga-frontend/node_modules/' \
  --exclude '/frontend/yoga-frontend/dist/' --exclude '/frontend/yoga-frontend/.angular/' \
  ./ /Volumes/docker/yoga-app/
```

Then start/rebuild **on the NAS** (SSH or Portainer): Docker Desktop on this Mac
builds `arm64` images, and the NAS runs `amd64`.

Helper scripts:

| Script | Purpose |
| --- | --- |
| `scripts/redeploy.sh` | pull, rebuild and restart the stack |
| `scripts/backup-db.sh` | nightly `pg_dump` with retention |
| `scripts/set-admin-password.sh` | replace the seeded admin password |
| `scripts/rotate-secrets.sh` | new `JWT_SECRET` and/or `POSTGRES_PASSWORD`, verified |

## Checks

```bash
cd frontend/yoga-frontend && npx prettier --check "src/**/*.{ts,html,css}" && npx ng build
cd backend && go vet ./... && go build ./...
cp .env.example .env && docker compose -f docker-compose.production.yml config --quiet
```
