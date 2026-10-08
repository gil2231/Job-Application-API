#!/usr/bin/env bash
# Installs or updates Applyance on a fresh Ubuntu 24.04 server. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/gil2231/Job-Application-API/main/deploy/install.sh | DOMAIN=applyance.app bash
#
# Running it again pulls the latest code and restarts what changed. Secrets are
# made once and kept in /opt/applyance/deploy/.env.
set -euo pipefail

# Everything runs inside main, so `curl | bash` has read the whole script before
# any command can swallow the rest of it from stdin.
main() {
DOMAIN="${DOMAIN:-}"
REPO="${REPO:-https://github.com/gil2231/Job-Application-API.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/applyance}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nError: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root."
[ -n "$DOMAIN" ] || die "set DOMAIN, for example: DOMAIN=applyance.app"

# Building the images needs more memory than small servers have.
if ! swapon --show --noheadings | grep -q .; then
  say "Adding 4 GB of swap"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 git openssl curl
  systemctl enable --now docker
fi

if [ -d "$DIR/.git" ]; then
  say "Updating the code"
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
else
  say "Downloading the code"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi

ENV_FILE="$DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Making the secrets"
  (
    umask 077
    cat > "$ENV_FILE" <<EOF
# Applyance settings. Made by deploy/install.sh; edit, then run install.sh again.
# Keep a copy of DATA_ENCRYPTION_KEY somewhere safe: without it, saved answers
# and site sign-ins can't be read.
DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
API_PUBLIC_URL=https://api.$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Real employer sites. Private and internal addresses stay blocked.
AUTOMATION_ALLOW_ALL_HOSTS=true
WORKER_CONCURRENCY=2

# Email (password resets, alerts): EMAIL_PROVIDER=resend with the two below.
EMAIL_PROVIDER=log
RESEND_API_KEY=
EMAIL_FROM=Applyance <hello@$DOMAIN>

# Payments. Leave empty to run without paid plans.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=

# Optional AI features.
AI_PROVIDER=
ANTHROPIC_API_KEY=
EOF
  )
fi

cd "$DIR/deploy"
say "Building and starting Applyance (the first time takes about 15 minutes)"
docker compose up -d --build --remove-orphans </dev/null

say "Waiting for the app to answer"
for _ in $(seq 1 60); do
  if docker compose exec -T web node -e 'fetch("http://127.0.0.1:3000/api/health").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' </dev/null 2>/dev/null; then
    ready=1
    break
  fi
  sleep 5
done
[ "${ready:-}" = 1 ] || die "the app didn't start. See: cd $DIR/deploy && docker compose logs web"

ip="$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
say "Applyance is running"
echo "Point these DNS records at this server, if you haven't yet:"
echo "  A  $DOMAIN      $ip"
echo "  A  api.$DOMAIN  $ip"
echo "HTTPS starts on its own a minute after they work. Then open https://$DOMAIN"
}

main "$@"
