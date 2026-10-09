#!/bin/bash
# Serves Applyance running on this Mac at https://applyance.app through a
# Cloudflare Tunnel. The domain must be on your Cloudflare account. Run:
#
#   curl -fsSL https://raw.githubusercontent.com/gil2231/Job-Application-API/main/deploy/mac-tunnel.sh | bash
#
# A browser opens once: pick the domain and click Authorize. The tunnel then
# starts at login and keeps running. Running it again is safe.
set -euo pipefail

# Everything runs inside main, so `curl | bash` has read the whole script before
# any command can swallow the rest of it from stdin.
main() {
DOMAIN="${DOMAIN:-applyance.app}"
NAME="${TUNNEL_NAME:-applyance}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-4000}"
CF_DIR="$HOME/.cloudflared"
TOOLS="$HOME/applyance-tools"
LABEL="app.applyance.tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nError: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "this script is for a Mac."
mkdir -p "$CF_DIR" "$TOOLS/logs" "$HOME/Library/LaunchAgents"

# launchd can't run programs from Downloads, Desktop or Documents, so use a
# copy of cloudflared in applyance-tools unless Homebrew installed it.
CF=""
for c in /usr/local/bin/cloudflared /opt/homebrew/bin/cloudflared "$TOOLS/cloudflared"; do
  if [ -x "$c" ]; then CF="$c"; break; fi
done
if [ -z "$CF" ]; then
  found="$(command -v cloudflared 2>/dev/null || true)"
  if [ -z "$found" ] && [ -x "$HOME/Downloads/cloudflared" ]; then found="$HOME/Downloads/cloudflared"; fi
  if [ -n "$found" ]; then
    cp "$found" "$TOOLS/cloudflared"
  else
    say "Downloading cloudflared"
    arch=amd64; [ "$(uname -m)" = arm64 ] && arch=arm64
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$arch.tgz" | tar -xz -C "$TOOLS"
  fi
  chmod +x "$TOOLS/cloudflared"
  CF="$TOOLS/cloudflared"
fi

if [ ! -f "$CF_DIR/cert.pem" ]; then
  say "A browser window opens. Click $DOMAIN, then Authorize."
  "$CF" tunnel login </dev/null
fi

if ! "$CF" tunnel info "$NAME" </dev/null >/dev/null 2>&1; then
  say "Creating the tunnel"
  "$CF" tunnel create "$NAME" </dev/null
fi
id="$("$CF" tunnel list --name "$NAME" --output json </dev/null | grep -Eo '"id": ?"[0-9a-f-]{36}"' | head -1 | grep -Eo '[0-9a-f-]{36}')"
[ -n "$id" ] || die "couldn't find the tunnel named $NAME."
if [ ! -f "$CF_DIR/$id.json" ]; then
  "$CF" tunnel token --cred-file "$CF_DIR/$id.json" "$NAME" </dev/null >/dev/null
fi

say "Pointing $DOMAIN and api.$DOMAIN at this Mac"
"$CF" tunnel route dns --overwrite-dns "$NAME" "$DOMAIN" </dev/null
"$CF" tunnel route dns --overwrite-dns "$NAME" "api.$DOMAIN" </dev/null

cat > "$CF_DIR/config.yml" <<EOF
# Made by deploy/mac-tunnel.sh
tunnel: $id
credentials-file: $CF_DIR/$id.json
ingress:
  - hostname: $DOMAIN
    service: http://localhost:$WEB_PORT
  - hostname: api.$DOMAIN
    service: http://localhost:$API_PORT
  - service: http_status:404
EOF

# The old free link isn't needed any more.
pkill -f "cloudflared tunnel --url" 2>/dev/null || true

say "Starting the tunnel (it starts by itself after a restart too)"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CF</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>$CF_DIR/config.yml</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$TOOLS/logs/tunnel.log</string>
  <key>StandardErrorPath</key><string>$TOOLS/logs/tunnel.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && sleep 2 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

for _ in $(seq 1 30); do
  if "$CF" tunnel info "$NAME" </dev/null 2>/dev/null | grep -Eq '[0-9]x[a-z]{3}|CONNECTOR ID'; then connected=1; break; fi
  sleep 2
done
[ "${connected:-}" = 1 ] || die "the tunnel didn't connect. See $TOOLS/logs/tunnel.log"

say "Done. Open https://$DOMAIN"
echo "It shows an error page until Applyance itself is running on this Mac."
}

main "$@"
