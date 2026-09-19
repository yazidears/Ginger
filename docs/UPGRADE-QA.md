# Upgrade verification

## Scope

Independent, read-only HTTP smoke tests and source review. Root agent owns rendered browser verification and build/restart. This report does not establish operational forecast accuracy or live Google model access.

Run `node scripts/test-api.cjs` against the production preview on port 3002, or set `GINGER_TEST_URL`. The default suite never initiates a simulation, sends an AI request, or mutates user records. `GINGER_TEST_MONITOR=1` adds one monitor contract check, which can initiate the normal backend scan. Tests have a 15-second per-request deadline and do not retry or repeatedly call external providers.

## Initial baseline, 19 September 2026

- Eleven checks passed on the pre-upgrade port-3002 server: coordinate validation, invalid provider mode, invalid scenario times, demo labels and cited scenario evidence.
- Unknown simulation ID returned a plain-text HTTP 500 instead of JSON 404. The current source handler already expresses 404; final rebuilt-server verification is required.
- Subsequent dev-port check failed to connect during the coordinated build transition. This is not evidence of a source regression.

## Source findings delivered to root

- Modal needed `aria-labelledby`; root reports fixed.
- Coordinate errors were invisible while Live was active; root reports moved next to input with `role="alert"`.
- Coordinate entry and the assessment-details toggle were hidden at mobile widths; root reports responsive controls restored.
- New regional overview originally started at `top:24px`, beneath the floating brand at 20–74px. Check it at desktop and mobile sizes after CSS integration.

## Fresh server recheck

All 15 API smoke checks passed against the fresh development server on `http://localhost:3002` on 19 September 2026. The unknown simulation-ID endpoint now returns JSON 404. Saved-area and operations read contracts, cache headers and AI configuration disclosure passed. This verifies the running development backend; production prerender/build validation remains separate.

## Final acceptance checklist

- Run all API smoke checks against a freshly started build, including unknown run, saved-area inventory, operations inventory and AI configuration disclosure.
- At 1440×900 and 390×844: no hidden primary control, horizontal overflow, header overlap or inaccessible modal footer.
- Keyboard: open/close each modal, return focus to invoker, enter coordinates, select an area, reach evidence and sources, operate forecast range.
- Failed providers must retain explicit unavailable/stale status; no synthetic replacement presented as observed evidence.
- Saved-area edits and operations tasks must survive reload; mutations need root's explicit functional test because this independent smoke script is read-only.
- Any simulation result must retain assumptions, evidence age and uncertainty labels; predicted impact is not an official evacuation instruction.

## Root acceptance, 2026-09-19

- Isolated production build passed with `GINGER_DIST_DIR=.next-upgrade npm run build` after dependency/runtime stabilization; application global error boundary added.
- Browser localhost:3002: opened saved watch areas, selected another sector, opened operations empty state, generated an evidence-linked briefing; tested 390px layout and restored desktop viewport.
- Actual scenario at 41.73572,1.81293 loaded ICGC geography and weather, completed five sensitivity members, returned 922 building footprints with height attributes. Hypothetical +120-minute output reached39 footprints; at0minutes it reached9. These counts are scenario outcomes, not observed fire impacts.
- Searched Casa Roca and selected its record: measured-source height8.1m and derived footprint145m² displayed; conditional modelled exposure16–32min shown with uncertainty limitations.
- Urban origin correctly refused to invent propagation when mapped burnable surface was absent.
- `npm test`, `npm run test:upgrades`, and15 read-only API checks passed. Authenticated WeatherNext/AI inference remains unverified. OSM assessment inventory can still be unavailable; ICGC simulation inventory succeeded.
