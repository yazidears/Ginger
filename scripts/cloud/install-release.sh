#!/usr/bin/env bash
# Run on ginger-forest-lab with an already uploaded immutable release directory.
set -euo pipefail
release="${1:?Supply the absolute release directory}"
base=/home/yazidears/ginger-app
case "$release" in "$base"/releases/*) ;; *) echo 'Unexpected release path' >&2; exit 1;; esac
cd "$release"
export NEXT_TELEMETRY_DISABLED=1 GINGER_EXTERNAL_WORKER=1
npm ci --no-audit --no-fund
npm --prefix integrations/imessage ci --no-audit --no-fund
npm run build
npm run test:backend
node scripts/test-prevention-refresh.cjs
node scripts/test-provider-reliability.cjs
npm run test:receptivity
npm run test:imessage
npm run typecheck:imessage
node --test scripts/cloud/webhook-proxy.test.cjs
node node_modules/typescript/bin/tsc --project tsconfig.forest.json --noEmit
mkdir -p "$base/shared/.ginger-data" "$base/shared/sage-runs" "$base/shared/snapshots"
test -f "$base/shared/.env.local"
ln -sfnT "$base/shared/.ginger-data" "$release/.ginger-data"
ln -sfnT "$base/shared/.env.local" "$release/.env.local"
read -r messaging_enabled messaging_port proxy_port proxy_enabled < <(node scripts/cloud/messaging-config.cjs)
case "$messaging_enabled:$proxy_enabled" in 0:0|1:0|1:1) ;; *) echo 'Invalid messaging configuration' >&2; exit 1;; esac
python=/home/yazidears/ginger-tools/python/bin/python
"$python" -c 'import rasterio,numpy,pyproj,requests,PIL'
unit_backup=$(mktemp -d)
for service in web worker messaging webhook-proxy; do
  if sudo test -f "/etc/systemd/system/ginger-$service.service"; then
    sudo cp "/etc/systemd/system/ginger-$service.service" "$unit_backup/ginger-$service.service"
    if sudo systemctl is-enabled --quiet "ginger-$service"; then touch "$unit_backup/ginger-$service.enabled"; fi
  fi
done
messaging_was_active=0
proxy_was_active=0
sudo systemctl is-active --quiet ginger-messaging && messaging_was_active=1
sudo systemctl is-active --quiet ginger-webhook-proxy && proxy_was_active=1
previous=$(readlink -f "$base/current" || true)
rollback() {
  trap - ERR
  set +e
  echo "Release activation failed; restoring previous services." >&2
  sudo systemctl stop ginger-messaging ginger-webhook-proxy
  for service in web worker messaging webhook-proxy; do
    if [ -f "$unit_backup/ginger-$service.service" ]; then
      sudo cp "$unit_backup/ginger-$service.service" "/etc/systemd/system/ginger-$service.service"
    else
      sudo systemctl disable "ginger-$service" 2>/dev/null || true
      sudo rm -f "/etc/systemd/system/ginger-$service.service"
    fi
  done
  sudo systemctl daemon-reload
  for service in web worker messaging webhook-proxy; do
    if [ -f "$unit_backup/ginger-$service.service" ]; then
      if [ -f "$unit_backup/ginger-$service.enabled" ]; then sudo systemctl enable "ginger-$service";
      else sudo systemctl disable "ginger-$service"; fi
    fi
  done
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    sudo systemctl restart ginger-web ginger-worker
    if [ "$messaging_was_active" = 1 ]; then sudo systemctl start ginger-messaging; fi
    if [ "$proxy_was_active" = 1 ]; then sudo systemctl start ginger-webhook-proxy; fi
    echo 'Previous release restored.' >&2
  else
    sudo systemctl stop ginger-web ginger-worker
  fi
  sudo rm -rf "$unit_backup"
  exit 1
}
trap rollback ERR
for service in web worker messaging webhook-proxy; do
  if [ "$service" = web ]; then
    command='/usr/local/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000'
    extra=''
    memory=8G
  elif [ "$service" = worker ]; then
    command='/usr/local/bin/node --conditions=react-server --import tsx scripts/backend-worker.ts'
    extra='Environment=NODE_OPTIONS=--conditions=react-server'
    memory=12G
  elif [ "$service" = messaging ]; then
    command='/usr/local/bin/node --import ./integrations/imessage/node_modules/tsx/dist/loader.mjs integrations/imessage/src/worker.ts'
    extra="Environment=IMESSAGE_PORT=$messaging_port"
    memory=2G
  else
    command='/usr/local/bin/node scripts/cloud/webhook-proxy.cjs'
    extra="Environment=IMESSAGE_PORT=$messaging_port
Environment=GINGER_WEBHOOK_PROXY_PORT=$proxy_port"
    memory=256M
  fi
  sudo tee "/etc/systemd/system/ginger-$service.service" >/dev/null <<EOF
[Unit]
Description=Ginger cloud $service
After=network-online.target ginger-forest.service
Wants=network-online.target

[Service]
Type=simple
User=yazidears
WorkingDirectory=$base/current
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=GINGER_EXTERNAL_WORKER=1
Environment=GINGER_FOREST_SERVICE=http://127.0.0.1:8788
Environment=GINGER_RASTER_PYTHON=$python
Environment=GINGER_SNAPSHOT_DIR=$base/shared/snapshots
Environment=SAGE_RUN_DIR=$base/shared/sage-runs
Environment=PATH=/home/yazidears/ginger-tools/python/bin:/usr/local/bin:/usr/bin:/bin
$extra
ExecStart=$command
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
MemoryMax=$memory
CPUQuota=400%

[Install]
WantedBy=multi-user.target
EOF
done
# Stop the current worker before changing its source symlink. Never overlap two
# messaging workers against the same subscriptions and provider cursor.
sudo systemctl stop ginger-messaging ginger-webhook-proxy 2>/dev/null || true
ln -s "$release" "$base/current.new"
mv -Tf "$base/current.new" "$base/current"
sudo systemctl daemon-reload
sudo systemctl enable ginger-web ginger-worker
sudo systemctl restart ginger-web ginger-worker
if [ "$messaging_enabled" = 1 ]; then
  sudo systemctl enable ginger-messaging
  sudo systemctl restart ginger-messaging
else
  sudo systemctl disable ginger-messaging
fi
if [ "$proxy_enabled" = 1 ]; then
  sudo systemctl enable ginger-webhook-proxy
  sudo systemctl restart ginger-webhook-proxy
else
  sudo systemctl disable ginger-webhook-proxy
fi
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/ >/dev/null && \
     curl -fsS --max-time 5 http://127.0.0.1:3000/api/forest/status >/dev/null && \
     sudo systemctl is-active --quiet ginger-web ginger-worker && \
     { [ "$messaging_enabled" = 0 ] || { sudo systemctl is-active --quiet ginger-messaging && curl -fsS --max-time 5 "http://127.0.0.1:$messaging_port/health" >/dev/null; }; } && \
     { [ "$proxy_enabled" = 0 ] || sudo systemctl is-active --quiet ginger-webhook-proxy; }; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" != 1 ]; then rollback; fi
trap - ERR
sudo rm -rf "$unit_backup"
printf 'Deployed: %s\n' "$release"
sudo systemctl is-active ginger-web ginger-worker ginger-forest
if [ "$messaging_enabled" = 1 ]; then
  sudo systemctl is-active ginger-messaging
  curl -fsS --max-time 5 "http://127.0.0.1:$messaging_port/health"
  printf '\nMessaging process is healthy; provider acceptance and handset delivery require separate live checks.\n'
fi
