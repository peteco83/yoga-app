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

Helper scripts:

| Script | Purpose |
| --- | --- |
| `scripts/redeploy.sh` | pull, rebuild and restart the stack |
| `scripts/backup-db.sh` | nightly `pg_dump` with retention |
| `scripts/set-admin-password.sh` | replace the seeded admin password |

## Checks

```bash
cd frontend/yoga-frontend && npx prettier --check "src/**/*.{ts,html,css}" && npx ng build
cd backend && go vet ./... && go build ./...
cp .env.example .env && docker compose -f docker-compose.production.yml config --quiet
```
