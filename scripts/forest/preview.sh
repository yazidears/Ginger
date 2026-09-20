#!/bin/sh
# Keep dependencies outside iCloud Documents to avoid offloaded-file build stalls.
set -eu
cd "$(dirname "$0")/../.."
repo=$(pwd)
preview="${GINGER_PREVIEW_DIR:-$HOME/.cache/ginger-forest-preview}"
mkdir -p "$preview/src/app/forest" "$preview/src/app/api/forest/[...path]" "$preview/src/components" "$preview/src/lib/forest" "$preview/public/maplibre"
cp src/components/forest-* "$preview/src/components/"
cp src/lib/forest/* "$preview/src/lib/forest/"
cp src/app/forest/page.tsx "$preview/src/app/forest/"
cp 'src/app/api/forest/[...path]/route.ts' "$preview/src/app/api/forest/[...path]/"
cp package.json package-lock.json "$preview/"
if [ ! -d "$preview/node_modules/next" ]; then npm ci --prefix "$preview" --no-audit --no-fund; fi
cp "$preview/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs" "$preview/node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs" "$preview/public/maplibre/"
cat > "$preview/src/app/layout.tsx" <<'EOF'
import 'maplibre-gl/dist/maplibre-gl.css';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body style={{margin:0}}>{children}</body></html>}
EOF
cat > "$preview/tsconfig.json" <<'EOF'
{"compilerOptions":{"target":"ES2020","lib":["dom","dom.iterable","esnext"],"strict":true,"noEmit":true,"skipLibCheck":true,"module":"esnext","moduleResolution":"bundler","jsx":"react-jsx","esModuleInterop":true,"resolveJsonModule":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./src/*"]}},"include":["next-env.d.ts","src/**/*.ts","src/**/*.tsx",".next/types/**/*.ts"],"exclude":["node_modules"]}
EOF
printf '%s\n' 'export default {devIndicators:false};' > "$preview/next.config.ts"
cd "$preview"
exec node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port "${PORT:-3018}"
