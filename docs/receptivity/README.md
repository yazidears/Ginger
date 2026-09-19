# GINGER live fire-receptivity system

The home route is now the Barcelona receptivity map. Existing inspection/replay/satellite tools remain in their own routes. No simulated values, ignition-time prediction, or LLM explanations enter the receptivity pipeline.

## Run

```sh
npm install
python3 -m venv .venv-receptivity
.venv-receptivity/bin/pip install -r requirements-receptivity.txt
npm run prepare:receptivity
npm run refresh:vegetation
npm run refresh:receptivity
npm run dev
```

The prepared geography artifact in `data/receptivity/barcelona-grid.json` contains real downloaded classifications, DEM-derived terrain, and dated satellite indices. Python is needed to regenerate it; serving and refreshing weather require Node only. The geography scripts use public endpoints and contain no credentials.

The user's persistent local installation runs at **http://localhost:3002** under the existing `local.ginger.web` and `local.ginger.worker` LaunchAgents. The worker refreshes scores every 15 minutes. With `GINGER_EXTERNAL_WORKER=1`, the API reads the worker's atomically published file and detects replacements; otherwise Next instrumentation starts its own refresh loop. Provider failures retain an explicitly stale snapshot, never new timestamps on old measurements. A first run without weather publishes HTTP 202 until a verified snapshot exists.

- Weather observations: XEMA public Socrata, 25 minute cache; half-hour/hour observations. Initial 31 day download, subsequent incremental two-hour overlap, deterministic deduplication. Required variables T/RH/rain/10 m wind. Stations with shorter-height wind only are not silently converted to 10 m.
- Forecast: Open-Meteo hourly model, then MET Norway Locationforecast if inaccessible; 60 minute persistent cache. HTTP 429 suppresses Open-Meteo requests for six hours within the worker. Live test found the daily shared-IP limit exhausted, so MET Norway is actually serving forecasts.
- Static terrain/land cover: geography preparation at most monthly in the persistent worker; terrain tile cache reused.
- Sentinel-2: worker checks daily; 30-day acquisition search, SCL cloud/shadow/water/snow mask, 50% minimum clear cell coverage. Cells without support retain missing indices. Latest successful indices remain explicitly dated if refresh fails.
- Official Generalitat Pla Alfa: public read-only ArcGIS FeatureServer, 30 minute cache. The official website embeds an Experience Builder application whose published configuration directly links this service; no HTML scraping is used by the pipeline. `editingInfo.lastEditDate` was 2026-08-18 during the 2026-09-19 test, so current levels are withheld. Its municipal names/boundaries are still used. Mapa de perill remains a linked reference because a current reliable machine-readable feed was not verified.

## API

`GET /api/receptivity` returns `{snapshot, refreshing, error, stale}`. Snapshot includes compact cell arrays for six horizons, the station assessments to which they refer, source status and full provenance. Conditional ETags avoid redownloading an unchanged snapshot.

`GET /api/receptivity/{cellId}?horizon=0` expands a cell to its full assessment, current/history conditions, fuel, terrain, explanatory factors and provenance. Valid horizons: 0, 1, 3, 6, 12, 24. Missing coverage is explicit; an unknown cell is HTTP 404. No user-supplied bounding box can trigger unbounded provider queries.

## Science and limits

See the user-visible `/methodology` route, `model.ts` equation comments, and [source references](SOURCES.md).

The hourly FFMC moisture-balance equations and FWI-system ISI are deterministic. FFMC uses the precise 147.27723 conversion coefficient, wet/dry equilibrium branches, hourly drying rate, and sub-hour rainfall without the daily FFMC interception threshold. XEMA interval-start times are converted to interval ends, and only completed intervals are used. Missing observations reset the state to the documented initialization of 85, then require 48 uninterrupted hours before a score is eligible. Rain totals require full coverage; no missing-as-zero substitution.

The two 0–100 transformations are **explicit display choices**, not calibrated probabilities:

- Receptivity: `clamp((FFMC - 60) / 40 * 100, 0, 100)`.
- Spread: `100 * ISI / (ISI + 20)`.

Fuel cover gates eligibility at 30% of a 200 m cell. The index applies **conditional on contact with the mapped vegetation**, not to the fraction of paved ground within a mixed cell. Nearest eligible station within 20 km supplies weather; therefore many adjacent cells legitimately share scores. Missing live fuel measurements, soil moisture, ET, canopy/load/curing and station-distance/elevation mismatch constrain interpretation. Sentinel indices and terrain are contextual, not unvalidated weighted score terms. ISI does not include slope and is not a propagation speed. Full FWI is not implemented because its daily DMC/DC/BUI states serve intensity estimation, not this initial conditional-receptivity index.

Forecast state holds latest measured fuel moisture to the current whole hour, with a maximum 90 minute observation age. This initialization bridge is an estimate. Forecast rain amounts are aligned to the previous accumulation interval (MET Norway supplies NEXT-hour amounts). Velocity uses change to +3H divided by actual elapsed hours from the observed state. Forecast bands remain experimental GINGER classes, not Catalan official danger levels.

**This is a live working system, not a validated operational fire-danger authority.** Equation and pipeline verification do not constitute validation against Catalan fire establishment outcomes or measured field fuel moisture. No active-fire, emergency restriction, ignition probability, or fire-arrival claim is made.

## Checks

```sh
npm run test:receptivity
npm run typecheck:receptivity
npm run refresh:receptivity
```

Tests exercise rain-versus-dry history, FFMC physical limits, wind response, missing rain, UTC interval boundaries, spin-up, observation staleness, and all six forecast horizons. Provider URLs were requested against actual services and the map was visually inspected in a real browser. Do not replace these live acceptance checks with fixtures.
