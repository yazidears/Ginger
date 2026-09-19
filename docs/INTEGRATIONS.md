# Integration boundaries

GINGER is a self-hosted Next.js/Node application. No Sites service is involved. The operational scenario is deliberately synthetic. Live observations are requested only from server routes and do not silently substitute into the scenario.

## Deepfire

Documentation inspected in a real browser and via HTTP on 2026-09-19:
- https://docs.deepfire.co/api/hotspots
- https://docs.deepfire.co/api/clusters
- https://docs.deepfire.co/quickstart

`POST https://api.deepfire.co/v1/token` accepts JSON `client_id`, `client_secret`; the response contains `access_token`. Alternatively configure a bearer token directly. GeoJSON is fetched from `/ogc/features/v1/collections/deepfire:hotspots/items` and `deepfire:clusters/items`. The implementation uses documented `bbox`, `filter-lang=cql2-text`, `filter=active = true`, `limit`, and `f=application/geo+json` parameters. Requests paginate up to five 1,000-item pages; repeated pages or incomplete results at the cap are rejected, with an explicitly labelled FIRMS fallback for assessments and monitoring.

Hotspot properties: `observed_at`, `cluster_id`, `source`, `confidence`, `fire_radiative_power` (MW, nullable), `country`, `active`. Cluster properties: `first_observed`, `last_observed`, `active`. Clusters are candidate fires, not official incidents. The read-only spread result method uses `/v1/fire-spread/simulations/{id}`. No billable spread job is automatically submitted.

Credentials are server environment values only. No authenticated Deepfire result has been verified without credentials. HTTP timeouts and one retry are bounded; repeated requests share a ten-minute in-process cache. The token cache follows the documented `expires_in` lifetime, renewing 30 seconds early.

## MTG / LSA SAF

Inspected https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MTG/MTFRPPixel/ and its `NATIVE/2026/09/18/` listing. Files follow `LSA-509_MTG_MTFRPPIXEL_MTG-FD_202609181240.nc`, at ten-minute intervals. A representative file request returned HTTP 401 with Basic authentication. **A native binary payload was not obtained, and native variable names were not guessed.**

`MTGProvider` accepts an operator-normalized local JSON export via `MTG_NORMALIZED_FILE`. Each row is `{id, observedAt: ISO8601, position: [longitude,latitude], frpMw, confidence?}`. It validates values and marks observations older than 30 minutes stale. Native NetCDF decoding, projection/geolocation, product quality flags and credentials must be supplied/validated before production ingestion. Merely loading an imported file is not proof of native satellite integration. `escalation()` orders observations by time and reports FRP ratios; it must be called on observations of the same fire.

The demo sequence is 4, 8, 21 and 49 MW: a 12.25× increase over 30 minutes. All are explicitly simulated.

## ELMFIRE

Inspected https://elmfire.io/, https://elmfire.io/user_guide.html and https://elmfire.io/input_reference.html. ELMFIRE is a Linux/MPI executable consuming terrain/fuel/weather/moisture GeoTIFFs and Fortran namelists. It is not an assumed REST service. The guide documents `&INPUTS`, `&OUTPUTS`, `&TIME_CONTROL`, `&SIMULATOR`; `DUMP_TIME_OF_ARRIVAL` and `DUMP_SPREAD_RATE` produce raster outputs.

`ElmfireProvider` is an **output import adapter**, accepting polygonized results via `ELMFIRE_PERIMETERS_FILE`. It does not run the solver, prepare missing rasters or treat imported perimeters as fresh forecasts. `DemoSpreadProvider` implements the same interface with an illustrative ellipse ensemble. Production work requires projected ignition coordinates, consistent raster CRS/extents/resolution, calibrated fuel/moisture inputs, arrival-raster polygonization and run metadata validation. ELMFIRE licensing must be reviewed for the intended deployment.

## Camera / Pyro-SDIS

Inspected https://huggingface.co/datasets/pyronear/pyro-sdis. Its documented records include images, YOLO-style annotation strings, image names, camera, partner and date. Dataset license is Apache-2.0. It is training/evaluation data, not a live Garraf feed. No dataset image has been misrepresented as live video.

`CameraInferenceProvider` is replaceable. `DemoCameraProvider` consumes synthetic RGB confidence and local thermal measurements, uses baseline, ambient/solar expectation and growth, and returns an inspection priority. The UI scene is an original synthetic SVG. No trained detector runs here. Object-specific glass/campfire/vehicle/spark recognition is not implemented and no such accuracy is claimed.

## Weather and infrastructure

Open-Meteo https://open-meteo.com/en/docs documents `/v1/forecast` and the current variables used in `OpenMeteoWeatherProvider`. This is modelled weather, not a physical station. It is read on demand and cached ten minutes.

Overpass query syntax was checked against https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL. `OSMProvider` issues a bounded, read-only query around Garraf for schools, hospitals, care facilities, stations and substations. Results are cached one day. OSM does not establish evacuation capacity, accessible roads or population; those fields are deliberately not fabricated in live responses. OSM attribution and ODbL apply.

The Catalonia Interior geographic catalog at https://interior.gencat.cat/ca/serveis/informacio-geografica/ was inspected. `CataloniaGISProvider` is an explicit unavailable boundary pending selection of a verified downloadable layer. It does not call a guessed endpoint. The demo's named asset positions and populations are synthetic scenario sites, not authoritative municipal records.

## Runtime and security

`GET /api/providers?mode=demo|live` returns per-provider status and normalized observations. `GET /api/scenario?minute=30&horizon=60` returns the reproducible demo. `POST /api/briefing` accepts bounded numeric scenario state and creates a structured, cited summary. All APIs reject malformed control inputs. User input never chooses an arbitrary external URL or local file. Environment file paths are operator configuration. The optional SAGE conversational analyst calls the OpenAI Responses API with a server-side key and the current evidence packet.

Before public deployment: add operator authentication, request rate limits, durable shared cache/storage, audit logging, provider quota controls and validated hazard/evacuation models. This prototype is intended for a local hackathon demonstration.

## Brand provenance

The user-supplied Figma design was inspected directly in the Figma desktop app: file `SY2Ib3KujvXWHLx97jEJBJ`, wordmark node `2018:78`, symbol node `2018:77`. Wordmark typography is Apple Garamond Regular, 122px, -6% tracking, fill #103000. The original wordmark and white symbol were exported as SVG into `public/ginger.svg` and `public/ginger-symbol.svg`. The app uses the vector outlines, not a redistributed font. The dark operational variant uses a light mask of the original lettering and retains forest green in the brand badge and surfaces. No Figma MCP was available; desktop inspection/export supplied the design context and screenshot.


## Connected observation mode (19 September 2026)

The default live workspace now uses `/api/live` rather than the simulation. The documented NASA FIRMS active-fire download service at https://firms.modaps.eosdis.nasa.gov/active_fire/ supplies the publicly accessible NOAA-20 VIIRS C2 Europe 24-hour CSV: https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv . Its actual header and rows were retrieved and checked. Acquisition dates/times are parsed as UTC; FRP is MW; textual confidence is retained. A detection is not declared a confirmed wildfire. Source timestamps are displayed, region selection filters bounding boxes, and records are never replaced with mock data. Ten-minute cache/polling.

Open-Meteo values populate the live weather panel. Overpass requests carry an identifying GINGER User-Agent as requested by the public server usage policy; this corrected the HTTP 406 seen with generic requests. The bounded query returned 31 actual schools/stations/substations and other amenities around Garraf during verification. Attribution remains visible; capacity/population/evacuation values stay unknown.

The previous `/api/providers` endpoint remains for demo provider diagnostics. Its simulated operational mode does not govern the new live workspace. Full MTG native decoding, trained CV and physical spread forecasting still require separate integrations.

## Prevention and inspection expansion (19 September 2026)

The default prevention workspace now uses the same Deepfire-first feed as point inspections and monitoring. `/api/detections` includes separate health for candidate clusters, latest estimated perimeter snapshots, and persistent heat-source polygons. Polygon geometry and metadata are validated; pagination stays on the documented host and uses the actual returned offset. Requests fail explicitly at the page/deadline cap. FIRMS remains a labelled hotspot fallback; absent supplementary layers are never reported as successful empty coverage.

Perimeters and persistent heat sources are selectable map layers in Prevent and Inspect. Perimeters are estimates, not confirmed fire boundaries; their acquisition watermark matters independently of retrieval time. Sage receives bounded cluster/perimeter/catalog metadata, source health and omitted counts. Neither a catalog source nor a task completion suppresses a fire signal.

All six HackBarna resources are listed under Sources with honest setup state. This does not activate raw MTG decoding, a trained Pyro-SDIS detector, Google WeatherNext authorization or an ELMFIRE runtime. Those remain separate requirements. No paid Deepfire simulations are submitted automatically. `npm run check:deepfire` verifies the four implemented Deepfire collections without printing credentials.

`data/catalonia-fire-regimes.geojson` contains 77 official Generalitat / Bombers ZHR v2014 zones, converted from the KMZ linked by the Interior catalog. `python3 scripts/import-catalonia-zones.py` reproduces the import. Coordinates retain polygon holes; point containment provides historical planning context to assessments and Sage. Edition and source are retained, and raw hazard codes are intentionally not interpreted as current risk. Source: https://interior.gencat.cat/web/.content/home/serveis/bases_cartografiques/ZHR/ZHR_v2014.kmz . Catalog updated 2019-09-03. Attribution: Generalitat de Catalunya, Departament d'Interior / Bombers.

A separate Prevention plan view groups evidence-linked proposals into prevention, asset checks and coordination. Creating an inspection refreshes its evidence on the server and saves a checklist, source names and evidence time. Duplicate active plan tasks at the same coordinates are reused. Operators can assign owners/review times, check off work, and link field observations. Completion requires finishing the checklist; it is an operator record, not verified risk reduction. No notifications or dispatch occur. Sage includes up to 20 nearby tasks and 20 unverified field reports within 10 km; unavailable operations storage is labelled. The mitigation link opens Ginger's existing scenario workspace, including its baseline/intervention tools.

Validation: `npm run test:prevention`, `npm test`, and `npm run test:upgrades`. Live AI analysis requires `OPENAI_API_KEY`; live Deepfire requires `DEEPFIRE_CLIENT_ID` and `DEEPFIRE_CLIENT_SECRET` (or a bearer token), stored server-side in `.env.local`. No credentials were fabricated.

### Persistent backend snapshots

The long-running Next Node server starts a background refresh loop through `src/instrumentation.ts`. It warms Catalonia satellite data and saved watch-area assessments, checks once per minute, and refreshes snapshots after five minutes. Browser and server assessment consumers share `.ginger-data/snapshots`; atomic writes survive server restarts. Requests for new coordinates require one initial fetch. Concurrent refreshes for the same key are coalesced within one server process. Saved data older than five minutes is labeled stale and returned while refresh runs; after one hour a successful fetch is required. Source observation timestamps are preserved. The worker bounds stored snapshots to 128 and does not call paid AI inference.

Run `npm run dev -- --port 3002` locally or a built `npm start` on an always-running Node host with persistent storage. This is a single-host backend, not a deployment: sleeping laptops and stopped servers cannot refresh. Serverless or multi-host deployment needs an external scheduled worker/shared database. Provider-specific cache lifetimes still apply (weather ten minutes, geographic inventory one day).

Validation: `npx tsx scripts/test-backend-snapshots.ts` checks shared cold requests, disk reuse, stale background refresh and hard expiry.

### Continuous workspace preparation

The worker now prepares each saved area's assessment, cited rules-based briefing and prevention checklists before clients connect. It publishes a workspace summary, monitor changes and regional detections to `/api/workspace`; this endpoint only reads disk and never initiates provider or model requests. The client polls prepared data, and preloads the default inspection location before opening Inspect. Unsaved locations still require a first assessment; add them to Areas for continuous preparation.

Astra summaries run separately after publication when OpenAI is configured. Each area has a persisted minimum 30-minute interval between attempts; unchanged evidence reuses its summary for up to six hours. Failed or outdated AI summaries fall back to the rules-based briefing. AI generation does not block deterministic assessments. These background calls consume OpenAI API usage. The workspace does not automatically run physical simulations or dispatch inspections.

For a separate worker process run `npm run backend` and set `GINGER_EXTERNAL_WORKER=1` on the Next server to disable its embedded worker. Both processes must use this project directory and persistent `.ginger-data` storage. Run exactly one worker per storage directory. A service supervisor/cloud Node host is required for 24/7 operation; local development remains dependent on this Mac being awake. Use `/api/workspace` to check readiness (202 while warming, 200 with a stale flag once published).

Snapshot storage defaults to `~/.cache/ginger-backend/<project-path-hash>` outside iCloud-managed Documents, so cloud file eviction cannot stall snapshot delivery. Set `GINGER_SNAPSHOT_DIR` to a persistent local volume for deployment, shared by the web server and worker. This supersedes the earlier `.ginger-data/snapshots` location; watch areas and operations retain their existing `.ginger-data` store.

### This Mac's running server

Frontend: `local.ginger.web`; continuous backend: `local.ginger.worker`. Both are macOS user LaunchAgents in `~/Library/LaunchAgents`, start on login, and restart after failures. Their working copy is `~/.cache/ginger-server`; logs are in its `logs` folder. Persistent watch areas and tasks now belong to that working copy's `.ginger-data` directory. The original watch-area file was copied without changing the source. Frontend port 3002 listens on the local network. Run `./scripts/update-local-server.sh` from this source checkout to sync changes and restart both services, preserving runtime state and credentials. The Mac must remain awake and connected. No public internet tunnel is configured.
