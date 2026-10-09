# Running Applyance on one server

The cheapest way to put Applyance live: one small Linux server runs everything (the web app, the API, the browser worker, Postgres, Redis, and Caddy for HTTPS) with Docker Compose. A server with 4 vCPU and 8 GB of memory, such as Contabo's Cloud VPS 4, costs around $8 a month. For managed hosting instead, see [deployment.md](deployment.md) (Render, about $55 a month).

Documents are stored on the server's disk, so this setup is for a single server. Email, payments and AI are optional and can be added later.

## 1. Get a server and a domain

1. Rent an Ubuntu 24.04 server with at least 4 GB of memory (8 GB is comfortable). Note its IP address and root password.
2. Buy your domain and, in its DNS settings, add two **A** records pointing at the server's IP:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` (the domain itself) | the server's IP |
| A | `api` | the server's IP |

## 2. Install

From a terminal on your computer, run this with your server's IP and your domain. It asks for the root password once.

```sh
ssh root@SERVER_IP 'curl -fsSL https://raw.githubusercontent.com/gil2231/Job-Application-API/main/deploy/install.sh | DOMAIN=applyance.app bash'
```

The script adds swap, installs Docker, downloads the code to `/opt/applyance`, makes the secrets in `/opt/applyance/deploy/.env`, builds everything and starts it. The first run takes about 15 minutes. HTTPS certificates arrive on their own about a minute after the DNS records work.

Copy `DATA_ENCRYPTION_KEY` from `/opt/applyance/deploy/.env` into a password manager. Without it, saved answers and site sign-ins can't be read.

## 3. Updating

Run the same command again. It pulls the latest code, rebuilds, applies database migrations and restarts what changed. Your settings and data stay.

## Adding email, payments or AI later

Edit `/opt/applyance/deploy/.env` on the server (for example `EMAIL_PROVIDER=resend` and `RESEND_API_KEY=...`), then run the install command again. [deployment.md](deployment.md) explains where each key comes from.

## Looking at what's running

```sh
cd /opt/applyance/deploy
docker compose ps
docker compose logs -f web worker
```
