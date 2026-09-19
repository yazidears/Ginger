# GINGER · Wildfire Intelligence Suite

A self-hosted Next.js + TypeScript operational wildfire decision-support prototype. It runs on a Node backend, without ChatGPT Sites and without API credentials.

## Run

Requires Node 22+ and npm.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. For a production build: `npm run build && npm start`.

## Connected assessment and SAGE

The default workspace continuously scans six Catalan sectors on the Node backend every ten minutes while the process is running. `/api/monitor` exposes actual weather and satellite evidence, review triggers and changes. Select a sector or enter any latitude/longitude to query `/api/assessment`; Deepfire satellite detections are preferred when server credentials are configured; the explicit NASA FIRMS fallback covers Europe only. Geographic inventory uses actual OpenStreetMap geometry within 1.5 km, and hourly weather comes from Open-Meteo. Missing inputs remain explicitly unavailable.

SAGE shows the reason for escalation, a 24-hour weather outlook, source provenance and missing inputs. These are uncalibrated review rules, not validated wildfire probabilities. Fire arrival and evacuation estimates are withheld in connected mode until validated inputs exist. MapLibre renders Mapzen terrain and actual OSM building heights or explicitly floor-derived heights; unknown heights remain unknown.

Google WeatherNext integration has an ADC-based export script and a validated optional backend file ingestion provider. Access approval and authenticated retrieval remain pending; see `docs/WEATHERNEXT.md`. WeatherNext does not silently replace Open-Meteo or assert wildfire forecast accuracy.

The **Demo scenario** button opens the separately labelled scripted exercise below. The earlier `/api/live` regional observation endpoint remains available for integration testing.

## Building-level simulation

The simulation engine is now **GingerO1 0.1.0**, experimental. It uses 16-direction surface propagation with crossed-cell barrier checks. A reproducible CSIRO grass-fire component benchmark and a separate analytical grid benchmark are in [the GingerO1 model card](docs/GINGER-O1.md). A training-fitted field calibration failed validation and was rejected; no real-incident perimeter or building-arrival accuracy is claimed.

Choose **Simulate fire spread** for the separate SAGE simulation workspace. Select a building or vegetation fire origin in Catalonia, choose a 1/2/4-hour horizon and review the spread assumptions. New runs default to Buildings + vegetation; Vegetation only remains available. A what-if run does not declare an incident; operator-confirmed runs require a reference.

The worker retrieves OpenStreetMap building ways/multipolygons supplemented with ICGC RTT footprints, plus ICGC land cover, decodes Mapzen terrain, and reads Open-Meteo hourly weather/radiation. It runs the Rothermel/BehavePlus equations on a 2 km × 2 km, 25 m grid with nine sensitivity members. Sun position, terrain/building shadows and optional approximate fine-fuel drying affect the calculation. The map timeline and building inspector show conditional surface-exposure windows, height provenance, footprint dimensions, roof shortwave estimates and radiant screening. Export preserves inputs, assumptions, source timestamps and all member arrival values.

The combined scenario allows ignition in buildings and transfer between neighbouring buildings and vegetation. The operator supplies a maximum footprint gap (default 10 m) and transfer delay (default 20 minutes per link). These are explicit hypothetical assumptions, **not a validated building-ignition or combustion model**. Unknown materials, fire walls, suppression, crown fire and firebrands are not resolved. Structural assumptions stay fixed across the nine weather/moisture sensitivity members. Red footprints indicate assumed structural ignition; orange indicates surface exposure. Vegetation-only mode keeps buildings as barriers. Unknown building heights remain flat on the map. These results do not replace the connected assessment's withheld operational arrival/evacuation claims.

`POST /api/sage/runs` starts a bounded child-process worker; `GET /api/sage/runs/:id` reads its persistent state/result. The local Node deployment must include `scripts/sage-worker.ts`, `src/lib/sage`, runtime dependencies and a writable run directory. `SAGE_RUN_DIR` optionally changes `.sage-runs`; jobs retain seven days of results, allow one active run, and time out after three minutes. This process model requires a long-running Node server, not an ephemeral/serverless request handler.

Run `npm run test:sage` for model, units, geometry, shadow, structural transfer, multipolygon inventory and invalid-input checks. The dedicated building inventory is cached in `.ginger-data/building-inventory` for 24 hours and shared between preview and worker; bounded OSM map extracts provide a fallback when Overpass is unavailable. See `docs/SAGE-BUILDING-PHYSICS.md` for implemented scope and the higher-fidelity roadmap.

## Demo journey

1. Choose DEMO, then press Reset to start at 12:00, then select the extreme Garraf zone or use Prevent.
2. Open GIR-024. Advance detection to observe possible smoke and a growing local thermal anomaly; switch RGB/Thermal.
3. Play or use Next event. At 12:10 the incident appears; at 12:20 satellite evidence arrives; at 12:30 spread and asset impacts appear.
4. Select FIRE GIR-04; drag the forecast through NOW, +30, +60, +120 and +240 minutes. Toggle map layers.
5. Inspect assets and evacuation assumptions. Initial timeline: road +31, school +48, residential +61 minutes.
6. Advance through the wind shift and prediction update. At 12:45 the residential margin is +6 minutes, down from +21.
7. Generate a briefing, review its cited values, and export it.

Space toggles playback, B opens a briefing, R resets the clock, / opens search. The initial screen is a paused 12:30 operational overview. All demo incident values are simulated and clearly labeled.

## Architecture

- `src/components/`: responsive map-first command surface, six working modules, camera inspection, asset details and grounded briefing.
- `src/lib/simulation.ts`: deterministic scenario, geometric spread envelopes, point intersections, evacuation estimates, event deltas and briefing facts.
- `src/lib/providers/`: normalized provider interfaces, Deepfire server client, MTG normalized ingestion, ELMFIRE output import, Open-Meteo, Overpass and replaceable camera inference.
- `src/app/api/`: Node-backed provider, scenario and briefing endpoints.
- `docs/INTEGRATIONS.md`: source documentation, verified contracts and explicit live-integration boundaries.
- `docs/MODEL.md`: calculations and limitations.

MapLibre uses public Esri imagery and CARTO/OSM labels; these require a network connection. The local scenario remains available offline after loading. Map and provider errors are surfaced. Native ELMFIRE computation, calibrated CV, native MTG decoding and production authentication are not claimed to be complete.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

The core tests cover the demo narrative, reproducibility, monotonic geometric growth, evacuation capacity, prediction deviation, parsers and solar-heating false positives.

## Trust boundary

This is a decision-support prototype, not an official dispatch/evacuation system. Synthetic asset positions/populations and routes require replacement with validated local data. Forecast ranks and confidence scores are uncalibrated. API credentials must remain in server-side environment variables. Review provider licensing and operational validation before deployment.

## Local workspace runtime

In this workspace, `node_modules` and `.next` are symlinked to `/Users/yazidears/.cache/ginger-runtime/` to avoid macOS cloud-file eviction of compiler assets. These local links are ignored by Git. A fresh clone uses the standard install commands above; no external directory is required. The checked production preview runs with `npm start -- --port 3002`.

## Change notifications

The live alerts feed compares consecutive regional scans every ten minutes. It reports wind speed changes of at least 5 km/h, direction changes of at least 15° (both readings at least 5 km/h), temperature changes of 3°C, humidity changes of 10 percentage points, thermal observations, hazardous-weather timing, coverage loss/recovery and review status. These are review thresholds. The first scan establishes a baseline; unchanged scans do not repeat alerts. Smaller changes are not accumulated between scans.

Changes include a sector, timestamp and before/after evidence, with acknowledgment and history controls. The server keeps the latest 50 changes in memory; restarting clears history. Acknowledgments are saved in this browser (up to 500 change IDs). Watch opens directly to alerts. New changes after the initial snapshot show a persistent in-app Review banner, including during inspection and simulation; unchanged scans do not repeat it. Dismissing the banner does not acknowledge its changes. Notifications are in-app only while Ginger is open, with the client checking for scan results every minute; no push or email delivery is used. Live fire-trajectory alerts require a validated spread feed. In the separately labelled demo, advancing the scenario automatically opens the changes feed and announces wind shifts, projected spread updates and critical evacuation-margin events.

## Watch areas, briefings and operations

Use **Areas** to select, save or remove a monitored circle (500–10,000 m radius; up to 20 areas). The backend persists these in `.ginger-data/watch-areas.json`. Area changes are picked up by the next monitor request; scheduled checks continue every ten minutes while this Node process runs.

Select a point or saved area, open **Sage**, then **Generate evidence briefing**. The deterministic briefing links each action to source records and exports a text report. It does not invent physical arrival times when required inputs are missing.

**Operations** records inspection tasks, acknowledgements, completion and explicitly unverified field observations. Writes are serialized and atomically persisted in `.ginger-data/operations.json`; activity history remains available. This is a single-process local prototype without authenticated operator identity or dispatch integration.

Run `npm run test:upgrades` for provider reliability, watch-area persistence, intelligence citation and operations concurrency checks. `node scripts/test-api.cjs` performs read-only checks against the running server.

## Watch-first workspace

Watch shows changes and active signals; Inspect opens the selected location, with simulations available there. Areas manages the watch list, Tasks opens the operations log, and More contains source details, the evidence key and the demo scenario. Alert evidence and timing expand on demand.

## Deepfire / HackBarna connection

Create a named API client at https://app.deepfire.co/settings/api-clients and put its ID/secret in the ignored `.env.local` using `.env.example`. Run `npm run check:deepfire` to verify an authenticated read without printing credentials, then restart the server after configuration. Keys remain server-side. The assessment, SAGE evidence packet, and watch-area monitor use Deepfire at the selected coordinates, retaining source, acquisition time, FRP and cluster ID. A failed or incomplete Deepfire request falls back explicitly to FIRMS within Europe. The providers are not merged, avoiding duplicate NOAA-20 counts. Provider changes are reported as coverage changes rather than fire growth.

Deepfire requests are bounded and paginated (at most five 1,000-item pages); exceeding the limit rejects the incomplete snapshot. Empty responses do not prove clear satellite coverage. The six-hour detection window uses acquisition time, not Deepfire's cluster `active` flag.

`OPENAI_API_KEY` is separate from Deepfire: it enables the existing SAGE conversational analyst. A Deepfire key supplies satellite evidence, not an LLM. MTG downloads, WeatherNext, ELMFIRE and Pyro-SDIS require their respective data processing, permissions or model work; generating credentials alone does not activate them.

## Investigation

SAGE adds compact Changes, What if, Correct, Observe, Exposure and Thermal views. Saved input snapshots support controlled branches and isolated driver comparisons; sourced GeoJSON enables perimeter corrections and infrastructure co-exposure. See [investigation methods and imports](docs/INVESTIGATION.md).

## Catalonia people and infrastructure

A server-side regional OSM inventory maps schools, hospitals/care, residential/work complexes, important roads and potential busy places. When weather or heat triggers flag a watch area, nearby features contribute up to 40 explicit exposure-priority points; the watch list uses this contribution within each review state. Map layers filter each category, and inspection shows counts, geometry distance and source date. Occupancy and footfall remain unknown.

See [Catalonia exposure import and rules](docs/CATALONIA-EXPOSURE.md) for installation, refresh, coverage and scoring. Run `npm run test:exposure` for the spatial and priority checks.

### Vegetation dryness

The connected location assessment now includes `vegetationDryness`: estimated dead fine-fuel moisture from the existing hourly FFMC calculation, driven by Open-Meteo temperature, humidity, 10 m wind and preceding-hour precipitation. It needs 72 contiguous historical hours and a complete current 24-hour outlook; missing, stale or inconsistent input withholds the estimate. Initial FFMC is 85, with 60/95 sensitivity runs; a residual moisture difference above two percentage points withholds the result. Rain at the current hour is processed only once.

Sage’s Outlook card follows the forecast slider. Below 6% is labelled “Extremely dry”, below 10% “Very dry”, below 16% “Dry”; these are Ginger display bands, not official danger classes or calibrated ignition thresholds. Extreme estimates feed a review reason, the cited briefing and prevention inspection checks. They never establish a fire or remove missing measured dead/live moisture from forecast requirements. Live plant moisture remains unknown. Saved estimates are explicitly stale; versioned assessment and prepared-area caches prevent old packets hiding the feature.

References: [Natural Resources Canada — FFMC](https://natural-resources.canada.ca/forests-forestry/wildland-fires/canada-fire-weather-index-system), [Open-Meteo weather and precipitation timing](https://open-meteo.com/en/docs). Run `npm run test:dryness`.
