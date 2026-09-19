# Catalonia exposure validation — 19 September 2026

Implemented in source and installed in the local runtime at `/Users/yazidears/.cache/ginger-server` (http://localhost:3002).

## Imported inventory

OpenStreetMap / Geofabrik Catalonia extract, source timestamp 2026-09-18T20:21:10Z. 143,037 OSM records; zero geometry conversion skips:

- Education: 4,064
- Healthcare: 1,332
- Residential/work complexes: 18,001
- Major-road segments: 102,955
- Potential gathering places: 16,685

The persistent dataset is `.ginger-data/exposure/catalonia.geojson` in the runtime. The workspace path currently links to the same verified dataset to avoid duplicate storage. OSM completeness and actual occupancy remain unknown.

## Verification

- Runtime TypeScript project: passed.
- `npm run test:exposure`: passed spatial distance, polygon holes, crossing roads, category caps, missing/stale/outside coverage, hazard gating, reload/corruption, API validation/filtering, bounded map response and full-inventory scoring checks.
- Existing assessment, monitor and intelligence tests: passed.
- Python importer classification and extract-boundary parser checks: passed.
- Live viewport API around central Barcelona returned 381 education/healthcare records, including named schools and healthcare centres.
- Live cell API: `utm31-200-401600-4608000` had 20 nearby records; at the tested snapshot, current receptivity 62 produced no uplift, while +24h receptivity 70 produced +12 exposure-priority points. These are timestamped test observations, not permanent current conditions.
- Browser verification on the new home map: five category filters present, school toggle changes state, ready source status shown, real geometry renders, nearby asset counts/details displayed.
- Desktop and 390 × 844 mobile views inspected. Captures: `output/playwright/catalonia-exposure-desktop.png` and `output/playwright/catalonia-exposure-mobile.png`.

No remote/cloud deployment or official inventory completeness is claimed. Receptivity/spread indices retain their own meaning; exposure is an additional uncalibrated review-priority contribution. Busy-place categories do not establish measured crowd frequency.
