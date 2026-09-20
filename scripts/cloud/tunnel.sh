#!/usr/bin/env bash
set -euo pipefail
exec gcloud compute ssh ginger-forest-lab \
  --project=ginger-wildfire-intelligence --zone=europe-southwest1-a \
  --tunnel-through-iap --quiet -- \
  -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "127.0.0.1:${GINGER_LOCAL_PORT:-3004}:127.0.0.1:3000"
