# Deploying Momkari Yoga on a UGREEN NAS

This deployment keeps PostgreSQL and the Go API private inside Docker. Cloudflare Tunnel publishes only the frontend over HTTPS, so router port forwarding is not required.

## 1. Prepare the NAS

Install Docker on the NAS and copy this repository to a directory such as `/volume1/docker/yoga-app`.

From the project directory:

```bash
cp .env.example .env
openssl rand -base64 48
```

Edit `.env` and replace every `replace-with-...` value. Use a unique database password and JWT secret. Keep `.env` private.

## 2. Create the Cloudflare Tunnel

In Cloudflare Zero Trust, create a remotely-managed tunnel and copy its token into `CLOUDFLARE_TUNNEL_TOKEN`.

Add a public hostname such as `www.example.com` with the service:

```text
http://frontend:80
```

The hostname must be routed through the same Cloudflare Tunnel that runs in this Compose stack.

## 3. Start the stack

```bash
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
```

Check logs if necessary:

```bash
docker compose -f docker-compose.production.yml logs -f frontend backend cloudflared
```

## 4. Verify the public site

Test the HTTPS hostname in a private browser window. Verify the homepage, language selector, contact form, and admin login.

The backend has no public homepage route; a `404` from `http://localhost:8080/` is not a frontend failure.

## 5. Backups and updates

Back up the `db_data` Docker volume regularly. To deploy a code update:

```bash
git pull
docker compose -f docker-compose.production.yml up -d --build
```

Do not use the default `admin/admin123` account on a public deployment. Change or remove that seeded account before launch.
