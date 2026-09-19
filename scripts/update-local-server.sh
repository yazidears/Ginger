#!/bin/zsh
set -eu
SOURCE_DIR="${0:A:h:h}"
SERVER_DIR="$HOME/.cache/ginger-server"
mkdir -p "$SERVER_DIR/scripts" "$SERVER_DIR/data"
rsync -a "$SOURCE_DIR/src" "$SOURCE_DIR/public" "$SOURCE_DIR/package.json" "$SOURCE_DIR/tsconfig.json" "$SOURCE_DIR/next.config.ts" "$SOURCE_DIR/next-env.d.ts" "$SERVER_DIR/"
rsync -a "$SOURCE_DIR/scripts/backend-worker.ts" "$SOURCE_DIR/scripts/satellite-raster.py" "$SERVER_DIR/scripts/"
rsync -a "$SOURCE_DIR/requirements-satellite.txt" "$SERVER_DIR/"
rsync -a "$SOURCE_DIR/data/catalonia-fire-regimes.geojson" "$SERVER_DIR/data/"
# Publish the completed exposure inventory atomically, preserving other server data.
if [[ -f "$SOURCE_DIR/.ginger-data/exposure/catalonia.geojson" ]]; then
  mkdir -p "$SERVER_DIR/.ginger-data/exposure"
  cp "$SOURCE_DIR/.ginger-data/exposure/catalonia.geojson" "$SERVER_DIR/.ginger-data/exposure/catalonia.geojson.tmp"
  mv "$SERVER_DIR/.ginger-data/exposure/catalonia.geojson.tmp" "$SERVER_DIR/.ginger-data/exposure/catalonia.geojson"
fi
# Preserve the server's watch areas, tasks, credentials and prepared snapshots.
launchctl kickstart -k "gui/$(id -u)/local.ginger.web"
launchctl kickstart -k "gui/$(id -u)/local.ginger.worker"
printf 'Ginger updated: http://localhost:3002\n'
