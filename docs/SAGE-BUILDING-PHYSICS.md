# SAGE: building-resolved wildfire forecasting

The current engine is GingerO1 0.1.0: nine sensitivity members and 16-direction surface propagation. The optional building-transfer scenario is an assumed distance/delay network. [The GingerO1 model card](GINGER-O1.md) supersedes earlier implementation counts below and records the field-component and numerical benchmark evidence; the higher-fidelity design remains a roadmap.

Implementation status, 19 September 2026.

## Implemented and locally exercised

The separate SAGE simulation workspace now fetches ICGC `construccions-rtt` building footprints and height attributes, ICGC `cobertes-sol`, Mapzen Terrarium terrain and Open-Meteo hourly weather/radiation. Source adapters are in `src/lib/sage/landscape.ts`. No API key is required for these public endpoints.

`src/lib/sage/engine.ts` executes the pinned `@cbevins/fire-behavior-simulator` 0.7.4 Rothermel/BehavePlus equations with five deterministic sensitivity cases. It integrates directional travel across a 25 m, 2 km square grid with changing weather, terrain slopes, building footprints as surface-fuel obstacles, and explicit land-cover-to-fuel assumptions. Geometry handles multipolygons, holes and cell/edge intersections. Exposure means a burning cell approaches within one cell diagonal of the footprint; it does not mean structural ignition or exact flame contact. This 35 m proximity criterion is a grid-resolution limitation.

SunCalc provides astronomical sun position. Raster ray tracing checks terrain and known building heights. A stated, simplified absorbed-shortwave/heat-transfer and Simard-equilibrium time-lag model estimates dead-fuel drying. Roof solar values assume flat roofs and average sampled roof cells; canopy shading, real roof shape/materials, rain wetting and longwave exchange are absent. Radiant screening uses an unshielded point-source approximation from the strongest single nearby fireline cell; it does not resolve facade heat flux.

The API runs the engine in a separate bounded Node worker, persists status/results and exposes a map timeline, per-building inspector and JSON export. It does not run ELMFIRE, FDS or WFDS. The architecture below remains the roadmap for higher-fidelity physics and validation, not a claim that those engines are integrated.

A live what-if test at 41.73196 N, 1.83816 E retrieved 789 mapped buildings with height attributes. Observed counts, weather and timings are a single retrieval snapshot, not a permanent fixture or confirmed fire. Unit checks reproduce the library's published reference calculation and exercise geometry, solar direction, missing data and wind conventions.

## Higher-fidelity design

## Product requirement

Following explicit incident confirmation, forecast evolving fire exposure for individual buildings using real geometry, terrain, vegetation, weather and solar forcing. Update forecasts when observations change. Distinguish flame contact, radiant heat, ember exposure, and ignition; an exposed building is not necessarily an ignited building.

Current code (`src/lib/assessment.ts`) retrieves OSM way footprints within 1.5 km and height tags or a labelled levels-times-three estimate. Multipolygon relations are excluded. Connected spread is withheld. The demo in `src/lib/simulation.ts` uses illustrative geometric envelopes, not building-resolved physics. Satellite thermal detections are not incident confirmation or perimeter measurements.

## Geographic foundation

For a first Catalan pilot, acquire Catastro INSPIRE building and building-part geometry and match it to ICGC terrain, surface and classified LiDAR data. Preserve source identifiers and dates; do not merge footprints solely by nearest centroid. Check roof outlines, multipart structures, courtyards and adjoining structures. Use Overture/OSM as supplementary coverage, with explicit source precedence and unresolved conflicts.

Sources checked:
- Catastro official building WFS and downloads: https://www.catastro.hacienda.gob.es/webinspire/index.html
- ICGC territorial LiDAR: https://www.icgc.cat/es/Geoinformacion-y-mapas/Datos-y-productos/Elevaciones/Elevaciones-territorial/LiDAR-Territorial
- ICGC terrain/surface products: https://www.icgc.cat/ca/Geoinformacio-i-mapes/Dades-i-productes/Elevacions/Elevacions-territorial/Models-delevacions
- Overture building schema/data guide: https://docs.overturemaps.org/guides/buildings/

These are documented data sources, not verified local coverage or completed retrievals. Check licensing, acquisition dates, vertical datums, resolution, endpoint limits and pilot coverage during ingestion. A rendered mesh is not automatically simulation-ready geometry.

Each building record needs a stable internal ID; source IDs; footprint and parts; local metric geometry; terrain-relative wall/roof elevations; roof shape; geometry quality; roof/wall/opening material observations; adjacent vegetation; and per-field provenance. Unknown materials stay unknown. Derive dimensions and footprint area in a suitable projected CRS (for the Catalan pilot, evaluate ETRS89 / UTM 31N), not in latitude/longitude degrees. Height above terrain and elevation above sea level are separate quantities. LiDAR sampling needs outlier, vegetation and acquisition-date checks.

## Simulation architecture

1. **Confirmed incident snapshot:** capture confirmation evidence, timestamped perimeter and its positional uncertainty. Keep observation time, ingestion time and forecast valid time distinct. Immutable snapshots make runs reproducible.
2. **Regional ensemble:** use a deployed landscape engine such as ELMFIRE with terrain, validated fuel classifications, dead/live moisture and time-varying wind. Enable and parameterize spotting explicitly. Perturb uncertain inputs and retain seeds and member outputs. Benchmark compute latency before promising an update interval.
3. **Local physics domains:** run selected threatened neighbourhoods through an independently deployed CFD/fire solver, evaluating FDS/WFDS-class capabilities against required mechanisms and validation cases. Resolve building-induced airflow, shielding, convection and radiant exposure. Material-dependent ignition, firebrands and structure-to-structure spread need explicitly supported and validated submodels; they must not be assumed merely because the solver handles fire and smoke.
4. **Solar forcing:** compute sun position from location and UTC time, then terrain/building/vegetation occlusion. Combine direct/diffuse radiation and cloud conditions with a surface energy/moisture model. Account for albedo, thermal properties, convection, longwave exchange and antecedent moisture. Sun position alone does not determine fuel dryness or fire direction. Shadow rendering is not a physical forcing calculation.
5. **Building exposure extraction:** intersect full footprints/parts with landscape arrival fields and sample local surface exposure where available. Record arrival intervals, incident heat flux in kW/m² and duration, ember metrics with defined units, and separate ignition results only where supported. Retain the physical mechanism and input assumptions behind each result.
6. **Observation update:** assimilate new perimeter, wind and moisture evidence, invalidate superseded outputs and rerun affected domains. A missing observation must not be interpreted as extinguishment.

Regional-to-local boundary transfer must define coordinate transforms, time interpolation, wind/temperature boundary profiles and conservation checks. Initial implementation should be explicitly one-way coupled; burning-building feedback into regional propagation requires a subsequent validated coupling method. Avoid double counting structural fuel or embers across domains.

ELMFIRE documentation: https://elmfire.io/ and https://elmfire.io/user_guide/spotting.html
NIST solver documentation: https://pages.nist.gov/fds/manuals.html
NIST modelling scope: https://www.nist.gov/programs-projects/advanced-fire-modeling

## Backend and result contract

Keep Next.js as the request/status/result layer. Use a job queue and dedicated simulation workers; large native numerical runs must not execute inside request handlers. Persist versioned inputs and outputs in object storage and geographic inventory in a spatial database. Preprocess static pilot geography before incidents.

A run records incident ID, confirmation revision, input hashes, observation cutoff, forecast origin/horizon, engine/version, grid/mesh resolution, member count and seeds, coverage polygon, runtime and validation status. States: awaiting-inputs, queued, running, completed, failed, superseded. Cancellation and timeouts cannot leave a completed-looking result.

Per-building output records building/geometry revision, covered/partially-covered/outside-domain status, exposure mechanisms, arrival interval where computed, modelled quantities with units, member support, missing inputs and source run ID. No intersection within a finite horizon means 'not reached in this run/horizon', never 'safe'. Ensemble member frequency must not be labelled calibrated probability without independent calibration. Invalid or unavailable inputs yield unavailable fields rather than zero risk.

The SAGE building panel should explain what may reach the structure, when, which assumptions drive the result, and whether local physics or regional screening produced it. Road safety and evacuation require separate dynamic route/capacity modelling.

## Delivery and acceptance sequence

- Establish one bounded pilot with reconciled cadastral footprints, measured/derived height quality, terrain and vegetation coverage. Verify geometry against independent surveyed samples. Publish coverage and missing-material statistics.
- Deploy and benchmark regional ensemble runs against historical incidents with held-out perimeters. Validate wind direction conventions, reprojection, units, timestamps, restart determinism and missing-data behavior.
- Evaluate neighbourhood solver capability on published verification/validation cases. Conduct mesh/time-step convergence and sensitivity studies for wind, radiation, ignition and embers where supported. Set acceptance thresholds with domain specialists before testing against held-out incidents.
- Connect regional and local results to building records; test partial coverage, courtyards, shared walls, stale inputs, failures and superseded runs. Measure arrival error and interval coverage, missed exposure and false alarms separately. Do not infer ignition accuracy from perimeter accuracy.
- Only after those checks expose validated forecasting claims. Until then label each run experimental and preserve existing connected-mode withholding for unsupported outputs.

Immediate engineering priority is the versioned building/terrain ingestion pipeline and solver worker contract. More detailed map extrusion alone does not satisfy this requirement.
