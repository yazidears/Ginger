#!/bin/sh
set -eu
archive="${1:-$HOME/.cache/ginger-forest-backups/ginger-data-$(date +%Y%m%d-%H%M%S).tar.gz}"
mkdir -p "$(dirname "$archive")"
gcloud compute ssh ginger-forest-lab --project=ginger-wildfire-intelligence --zone=europe-southwest1-a --tunnel-through-iap --quiet --command="python3 -c \"import sqlite3; a=sqlite3.connect('/home/yazidears/ginger-data/forest.sqlite'); b=sqlite3.connect('/home/yazidears/ginger-data/forest-backup.sqlite'); a.backup(b); b.close(); a.close()\""
gcloud compute ssh ginger-forest-lab --project=ginger-wildfire-intelligence --zone=europe-southwest1-a --tunnel-through-iap --quiet --command='tar --exclude=forest.sqlite --exclude=forest.sqlite-wal --exclude=forest.sqlite-shm --exclude=core --exclude=source.laz -czf - -C /home/yazidears ginger-data ginger-tools/forest' > "$archive.partial"
gzip -t "$archive.partial"
mv "$archive.partial" "$archive"
printf '%s\n' "$archive"
