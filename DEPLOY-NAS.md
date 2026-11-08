# Deploying Momkari Yoga on the NAS (Cloudflare Tunnel)

The site runs at home on the NAS and is published through a Cloudflare Tunnel:
no router port forwarding, no public IP, no certificate to renew by hand.

```
            HTTPS                      outbound-only tunnel
Visitors ─────────▶ Cloudflare edge ───────(cloudflared)───────┐
                   TLS · cache · WAF                          │
                                                              ▼
                                     NAS · docker compose "yoga-app"
                          ┌──────────────────────────────────────────────┐
                          │ cloudflared ─▶ frontend (nginx :80)          │
                          │                     │  /            → Angular│
                          │                     │  /api/*       → API    │
                          │                     ▼                        │
                          │              backend (Go :8080)              │
                          │                     │                        │
                          │                     ▼                        │
                          │              postgres (private network)      │
                          └──────────────────────────────────────────────┘
```

What that buys you:

- **Nothing is exposed.** The NAS makes only outbound connections, so there is
  no open port to scan and the home IP stays hidden.
- **Postgres is unreachable from outside.** It lives on `db-net`, an internal
  network with no internet egress; only the API container joins it.
- **HTTPS, caching and DDoS protection** come from Cloudflare on the free plan.
- **The API is same-origin** (`/api/*` is proxied by nginx), so there is no CORS
  configuration to maintain for the public site.

---

## 0. What you need

| Item | Notes |
| --- | --- |
| A domain | Its nameservers must be on Cloudflare (free plan is enough) |
| NAS with Docker + Compose | UGOS Pro: App Center → Docker. UGOS also ships Portainer on `:9000`; SSH is **off** by default (enable it in the control panel) |
| RAM / disk | ~2 GB free RAM for the first build, ~4 GB disk |

Placeholders used below: `<your-domain.com>` and `<nas-ip>`.

---

## 1. Put the domain on Cloudflare

1. Cloudflare dashboard → **Add a site** → type `<your-domain.com>` → choose the
   **Free** plan.
2. Cloudflare shows two nameservers. At your registrar (where you bought the
   domain) replace the current nameservers with those two.
3. Wait for the zone to show **Active** (minutes to a few hours).

Optional but recommended: register/transfer the domain through **Cloudflare
Registrar** so DNS and billing live in one place (sold at cost, no markup).

---

## 2. Create the tunnel

1. Go to **Zero Trust** (`one.dash.cloudflare.com`) → **Networks → Tunnels** →
   **Create a tunnel** → connector type **Cloudflared**.
2. Name it `momkari-nas` and save.
3. On the install screen pick **Docker** and copy the token: the long string
   after `--token`. That is `CLOUDFLARE_TUNNEL_TOKEN`.
4. Still on that screen, add the **public hostnames**:

   | Subdomain | Domain | Path | Service |
   | --- | --- | --- | --- |
   | *(empty)* | `<your-domain.com>` | *(empty)* | `http://frontend:80` |
   | `www` | `<your-domain.com>` | *(empty)* | `http://frontend:80` |

   `frontend` is the Compose service name, resolved inside the tunnel's Docker
   network. Do **not** use `localhost` here: `cloudflared` and `nginx` are
   different containers.

5. **SSL/TLS → Overview**: set the encryption mode to **Full**.
   The origin speaks plain HTTP inside the tunnel, so **Full (strict)** answers
   `526 Invalid SSL certificate`.
6. **SSL/TLS → Edge Certificates**: enable **Always Use HTTPS**, **Automatic
   HTTPS Rewrites**, **Brotli** and **HTTP/3**. Turn on **HSTS** once you have
   confirmed HTTPS works everywhere (it is sticky in browsers).
7. **Speed → Optimization**: enable **Early Hints** (nice for the font CSS).

---

## 3. Put the code on the NAS

Both routes end at the same place: `/volume1/docker/yoga-app` with a filled-in
`.env`. Pick one.

### 3a. From a shell on the NAS (git)

SSH is **off by default** on UGOS. Turn it on in the NAS UI (Control Panel →
Terminal / SSH), then check it from your machine:

```bash
nc -z <nas-ip> 22 && echo "ssh is open"
```

```bash
ssh <user>@<nas-ip>
sudo mkdir -p /volume1/docker
cd /volume1/docker
git clone https://github.com/peteco83/yoga-app.git
cd yoga-app
```

Later updates are just `./scripts/redeploy.sh`.

### 3b. From the Mac, through the mounted share (no SSH)

If the NAS share is mounted (Finder → Connect to Server → `smb://<nas-ip>/docker`)
it appears as `/Volumes/docker`, so this folder *is* the NAS folder:

| On the Mac | On the NAS |
| --- | --- |
| `/Volumes/docker/yoga-app` | `/volume1/docker/yoga-app` |

Push the working tree over and let `rsync --delete` remove files that no longer
belong (old compose files, renamed components):

```bash
cd ~/Projects/yoga-app
rsync -a --delete \
  --exclude '/.env' --exclude '/.git/' --exclude '/backups/' --exclude '.DS_Store' \
  --exclude '/backend/backend' --exclude '/backend/api' \
  --exclude '/frontend/yoga-frontend/node_modules/' \
  --exclude '/frontend/yoga-frontend/dist/' --exclude '/frontend/yoga-frontend/.angular/' \
  ./ /Volumes/docker/yoga-app/
```

Why those excludes are not cosmetic:

- `/.env` holds the NAS secrets. Copying it from the Mac silently replaces the
  database password of a *running* database with a different one.
- `dist/`, `.angular/` and `backend/backend` are host build output. The Mac is
  `arm64`, the NAS is `x86_64`: shipping them wastes 30+ MB and can mask a broken
  build (`exec format error` inside the container).

> **Images must be built on the NAS, not on the Mac.** Docker Desktop builds
> `linux/arm64`; the NAS needs `linux/amd64`. Build over SSH/Portainer on the NAS
> and the architecture is correct automatically. Only if you deliberately prebuild
> on the Mac, force the platform (see Appendix A).

> Files written over SMB arrive as `rwxrwxrwx`; that is fine, nothing outside the
> containers reads them.

**If you do not want SSH either:** Portainer already runs on
`http://<nas-ip>:9000`. *Stacks → Add stack → Repository* →
`https://github.com/peteco83/yoga-app`, compose path
`docker-compose.production.yml`, and put the `.env` values in the *Environment
variables* section. Redeploy with *Pull and redeploy*. The NAS then builds from
its own clone, so treat that clone — not the SMB folder — as the source of truth.

### 3c. Fill in `.env`

On the NAS (or through the share, editing `/Volumes/docker/yoga-app/.env`):

```bash
cp .env.example .env
openssl rand -base64 48          # copy the output into JWT_SECRET
nano .env                        # fill in the values below
chmod 600 .env
```

Values to fill in `.env`:

| Variable | What it is |
| --- | --- |
| `POSTGRES_PASSWORD` | Long random password. Letters, digits, `-` and `_` only (it is embedded in a URL) |
| `JWT_SECRET` | The `openssl rand -base64 48` output. Rotating it logs every admin out |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token from step 2 |
| `LAN_BIND` | Leave `127.0.0.1`; set `0.0.0.0` only while testing from your LAN |

Generate a strong password without special characters:

```bash
openssl rand -base64 32 | tr -d '/+=' | cut -c1-32
```

> No SMTP settings are needed: the contact form stores messages in the database
> and you read them on the **Messages** page (`/admin/messages`).

---

## 4. First start

```bash
cd /volume1/docker/yoga-app
docker compose -f docker-compose.production.yml up -d --build
```

> **Already deployed once from this folder?** Compose names the volume after the
> project directory (`yoga-app_db_data`), so an existing volume — including one
> created by the old `docker-compose.nas.yml` — is reused as-is: `init.sql` does
> not run again and the data stays. The `POSTGRES_PASSWORD` in `.env` must then be
> the one the database was created with (keep the value that was already there).

The first build downloads the Node and Go images and compiles the site: expect
3–10 minutes on a NAS. Then:

```bash
docker compose -f docker-compose.production.yml ps
```

All four services must be `running`, and `yoga-api` / `yoga-ui` `healthy`.
`docker compose -f docker-compose.production.yml logs -f cloudflared` should end
with `Registered tunnel connection`.

---

## 5. Verify

```bash
# nginx, straight from the NAS (no public port involved)
curl -fsS http://127.0.0.1:5007/healthz          # ok

# the whole chain, through Cloudflare
curl -fsS https://<your-domain.com>/healthz      # ok
curl -fsS https://<your-domain.com>/api/health   # {"status":"ok"}
```

Then, in a private browser window: load the site, switch language, send the
contact form, log in to the admin area.

---

## 6. Change the seeded admin password — before announcing the site

`database/init.sql` creates `admin` / `admin123`. That must not survive contact
with the internet.

```bash
./scripts/set-admin-password.sh
# another account: ./scripts/set-admin-password.sh <username>
```

The script hashes with PostgreSQL's `pgcrypto`, which produces the same bcrypt
format the Go API verifies. Then log in at `https://<your-domain.com>/login` to
confirm.


---

## 7. Put the admin area behind Cloudflare Access (recommended, free)

The admin pages are public URLs protected only by the login form. Cloudflare
Access adds a second gate at the edge — the page never reaches the NAS unless
the visitor proved who they are.

**Zero Trust → Access → Applications → Add an application → Self-hosted**, then
create one application per path:

| Application name | Domain | Path |
| --- | --- | --- |
| Momkari · login | `<your-domain.com>` | `login` |
| Momkari · members | `<your-domain.com>` | `admin` |
| Momkari · messages | `<your-domain.com>` | `admin/messages` |

Policy for each: **Action: Allow**, **Include → Emails →** your email.
Session duration 24h. Save.

Login options: *One-time PIN* works with no extra account (a code arrives by
email); Google/GitHub are also available.

Notes:

- Access covers the SPA routes only. `/api/*` stays open so the Angular app can
  call it with the JWT it already holds — the API is protected by that token and
  by the login rate limit below.
- Keep an Access session open (or use the *Bypass* policy for your own email) if
  you are testing the admin area from an automated script.

---

## 8. Rate-limit the login form (free plan includes one rule)

**Security → WAF → Rate limiting rules → Create rule**

- Rule name: `login brute force`
- If incoming requests match: **URI Path** `contains` `/api/login` **and**
  **Method** `equals` `POST`
- Rate: `10` requests per `1 minute`, counting by **IP**
- Action: **Block**, duration `10 minutes`

Optional extras: **Bots → Bot Fight Mode** on, **Security Level: Medium**.

---

## 9. Day-two operations

**Deploy an update**

```bash
cd /volume1/docker/yoga-app
./scripts/redeploy.sh          # git pull + rebuild + restart + prune
```

Only the containers whose files changed are rebuilt; downtime is a few seconds.
If the update changed images or translations, also purge the cache:
**Cloudflare → Caching → Configuration → Purge Everything**.

**Logs**

```bash
docker compose -f docker-compose.production.yml logs -f --tail=100 backend
docker compose -f docker-compose.production.yml logs -f --tail=100 cloudflared frontend
```

**Backups** (the volume itself is on the NAS, but dumps are portable)

```bash
./scripts/backup-db.sh            # backups/<db>-<timestamp>.sql.gz, keeps 14 days
```

Nightly cron on the NAS (`crontab -e`):

```cron
30 3 * * * cd /volume1/docker/yoga-app && ./scripts/backup-db.sh >> backups/backup.log 2>&1
```

Copy `backups/` somewhere off the NAS regularly (another disk, Backblaze B2,
rclone to a cloud drive). A backup that lives only on the NAS is not a backup.

**Restore**

```bash
gunzip -c backups/yoga_app-20261108-033000.sql.gz \
  | docker compose -f docker-compose.production.yml exec -T postgres \
      psql -U yoga_admin -d yoga_app
```

**Disk**

```bash
docker system df                  # images, volumes, build cache
docker image prune -f             # stray layers after rebuilds
```

**Uptime check** (optional): point a free monitor (UptimeRobot, BetterStack) at
`https://<your-domain.com>/healthz`. It is served by nginx without touching the
API, so it stays green when only the backend is down; use `/api/health` when you
want to include the database in the check.


---

## 10. Security checklist

- [ ] `.env` is `chmod 600`, contains a 32+ character DB password and a fresh
      `JWT_SECRET`; nothing secret is committed to git.
- [ ] No port forwarding on the router; `LAN_BIND` stays `127.0.0.1`.
- [ ] Cloudflare SSL/TLS mode is **Full**, *Always Use HTTPS* and *HSTS* on.
- [ ] Seeded `admin` / `admin123` password replaced (step 6).
- [ ] Cloudflare Access in front of `login`, `admin`, `admin/messages`.
- [ ] Rate limiting rule on `POST /api/login`.
- [ ] Nightly backups running, with a copy off the NAS.
- [ ] 2FA on the Cloudflare account (it also protects your DNS).
- [ ] `docker compose -f docker-compose.production.yml ps` shows no service with
      a public port other than the LAN-only bind.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `502 Bad Gateway` on the site | API container down or unhealthy | `docker compose ... logs --tail=100 backend` |
| `cloudflared` restarts in a loop | Token wrong/expired, or outbound UDP/TCP 7844 blocked | `logs` say `Provided Tunnel token is not valid.` while `.env` still holds the placeholder — paste the token from step 2 and `docker compose ... up -d` |
| `cloudflared` logs `failed to dial` / timeouts | The NAS firewall blocks outbound 7844 | Allow outbound TCP+UDP 7844 (egress only, no port forwarding) |
| Error `1033` from Cloudflare | The tunnel has no healthy connector | `docker compose ... logs cloudflared` |
| Error `526` | SSL/TLS mode is *Full (strict)* but the origin is HTTP | Set **Full** |
| `ERR_TOO_MANY_REDIRECTS` | Mode *Flexible* combined with *Always Use HTTPS* | Set **Full** |
| Login always answers *Invalid credentials* | The seeded hash was replaced by hand | `./scripts/set-admin-password.sh` |
| `password authentication failed for user` in the API logs | `POSTGRES_PASSWORD` was changed after the volume was created — Postgres only reads it on first init | Recreate the volume (`... down -v`, loses data) or run `ALTER USER yoga_admin WITH PASSWORD '...'` in `docker exec -it yoga_app_db psql -U yoga_admin -d yoga_app` |
| Old page after a deploy | Browser or Cloudflare cache | Purge Cloudflare cache; hard reload (`index.html` is `no-cache`) |
| `relation "admins" does not exist` | `init.sql` only runs on an empty volume | `docker compose ... down` then remove the `db_data` volume, or apply `database/init.sql` by hand |
| Backend restart loop with `JWT_SECRET must be configured` | `.env` missing or not loaded | Run compose from the folder that holds `.env` |
| Container exits with `exec format error` | The image was built on a Mac (`arm64`) instead of the NAS (`amd64`) | Rebuild on the NAS, or `docker build --platform linux/amd64` (Appendix A) |
| `cp: .env` overwrote the password and the API cannot log in | The Mac copy was synced over the NAS `.env` | Restore `.env` from the backup, or `ALTER USER` (row above); the rsync in 3b excludes `/.env` for this reason |
| Contact form works but you get no email | By design: messages are stored only | Read them on the **Messages** page (`/admin/messages`) |

Useful one-liners:

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=200 backend cloudflared
docker exec yoga-ui wget -qO- http://127.0.0.1/healthz
docker exec yoga-api wget -qO- http://127.0.0.1:8080/health
```

---

## 12. Why this shape, and not something else

| Option | Verdict |
| --- | --- |
| **Cloudflare Tunnel + NAS** | ✅ Chosen. Free, HTTPS, cache, WAF, no open ports, data stays home |
| Cloudflare Pages / Netlify / Vercel | Only for the static frontend. The Go API and Postgres would still need a host, and then you get CORS and two deploy pipelines |
| Port forwarding + Let's Encrypt on the NAS | Works, but exposes the home IP and needs 80/443 open; more attack surface and more to maintain |
| Tailscale Funnel | Fine for private access, no custom-domain HTTPS with caching; less suitable for a public site |
| ngrok free | Random URL, bandwidth limits, not for production |
| A VPS (Hetzner ~€4/mo) | The alternative if the NAS must stay off the internet; you take care of updates, TLS and backups yourself |

Cloudflare free plan covers everything above. Paid add-ons only become relevant
with heavy traffic (advanced WAF, image resizing, Argo).

---

## Appendix A — build once locally, pull on the NAS (optional)

Building on the NAS costs a few minutes of CPU. If you prefer, build on your
laptop or in CI and push to the GitHub Container Registry, then run the NAS with
`image:` instead of `build:`:

```bash
# on your machine
echo "$GH_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
# --platform is mandatory: an Apple Silicon laptop builds arm64, the NAS is amd64
docker build --platform linux/amd64 -t ghcr.io/peteco83/yoga-api:latest ./backend
docker build --platform linux/amd64 -t ghcr.io/peteco83/yoga-ui:latest ./frontend/yoga-frontend
docker push ghcr.io/peteco83/yoga-api:latest
docker push ghcr.io/peteco83/yoga-ui:latest
```

Then replace `build: { context: ... }` with
`image: ghcr.io/peteco83/yoga-api:latest` (and the UI equivalent), log the NAS in
with a read-only token, and `docker compose pull && docker compose up -d`.

## Appendix B — LAN-only access, no Cloudflare

To use the site on the home network before a domain exists:

1. `LAN_BIND=0.0.0.0` in `.env`.
2. Comment out the `cloudflared` service.
3. `docker compose -f docker-compose.production.yml up -d`.
4. Browse to `http://<nas-ip>:5007`.

Plain HTTP on the LAN is fine for testing, but never expose that port through
the router.

