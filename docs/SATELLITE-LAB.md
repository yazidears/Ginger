# Satellite Lab

Open `/satellite` from the Satellite item in Ginger's navigation. A `lat` / `lon` query selects the study point. Observed history, Level-2 fire-product measurements, multispectral indices and forecast polygons have separate views.

## Implemented

- **Fire history:** complete bounded Deepfire hotspot and perimeter queries over a 25 km envelope, with 1–7 day windows. The timeline accumulates observations and selects the latest perimeter snapshot per cluster at the chosen time. Per-source/minute FRP bars avoid combining satellite acquisitions into one purported instantaneous power. Both original GeoJSON collections can be exported. Missing or incomplete archive layers are labelled unavailable. The FIRMS fallback is explicitly limited to its Europe 24-hour window.
- **Sensor measurements:** original NASA FIRMS NOAA-20 VIIRS CSV fields, including I4/I5 brightness temperatures, FRP, scan/track size, confidence and day/night. Thermal contrast is I4 minus I5; it is not ground temperature or a calibrated ignition probability. This feed is kept separate from Deepfire to avoid duplicate counts. These are Level-2 fire-product records, not Level-1 radiance packets.
- **Spectral imagery:** public Sentinel-2 Collection 1 L2A scenes from Element 84 Earth Search. The UI lists the latest 20 matching scenes from 60 days and prefers a recent tile with under 10% cloud. It computes NDVI `(B08-B04)/(B08+B04)`, NBR `(B08-B12)/(B08+B12)` and optional dNBR `earlier NBR - later NBR`. The worker reads only small COG windows and reprojects onto the same 128 × 128, 20 m grid (2.56 km square) for comparisons. It applies each asset's STAC scale and offset. SCL classes 4 and 5 are retained; clouds, shadows, snow, water, uncertain classes, nodata, negative reflectance and zero denominators are masked. Valid-pixel percentages are per index. dNBR uses the valid intersection. No burn-severity classes, fuel moisture or automatic fire confirmation are inferred. PNG and georeferenced numeric JSON exports include provenance, band URLs, calibration, grid CRS/transform and formulas. Raw calibrated band GeoTIFF links are also available.
- **Spread simulation:** an explicit button submits one Deepfire ELMFIRE/ForeFire point-ignition job (1–24 hours, 1–50 members). A POST is never automatically retried. Polling begins after 10 seconds and handles QUEUED, COMPLETED, NO_SPREAD and FAILED. A run ID can be recovered after reopening the page. An ambiguous submission instructs the operator to check Deepfire before resubmission. Hourly polygons can be replayed/exported. A local per-process submission guard supplements provider limits. Runs may consume paid usage and model coverage varies.

## Setup

Deepfire uses existing server-only `DEEPFIRE_CLIENT_ID` and `DEEPFIRE_CLIENT_SECRET`, or `DEEPFIRE_TOKEN`. NASA FIRMS and the public Sentinel catalog/COGs need no account key.

Install an isolated raster runtime:

```sh
python3 -m venv ~/.cache/ginger-satellite-python
~/.cache/ginger-satellite-python/bin/pip install -r requirements-satellite.txt
```

The API defaults to that Python executable. For deployment set `GINGER_RASTER_PYTHON` to the environment's absolute Python path, install the same requirements, and include `scripts/satellite-raster.py`. This requires a Node host that supports child processes, not an Edge runtime. Processing is bounded to one raster worker per Node process, a 90-second deadline, approved catalog assets and a 2 MB response. Successful results are cached for one hour in the bounded provider cache.

No deployment, account purchase, external notification or paid simulation submission is part of this implementation. Existing public-deployment authentication and quota requirements still apply; the same-origin simulation check is not user authentication.

## Validation (19 September 2026)

```sh
./node_modules/.bin/tsc --project tsconfig.satellite-lab.json
npm run test:satellite-lab
~/.cache/ginger-satellite-python/bin/python scripts/test-satellite-raster.py
./node_modules/.bin/tsx scripts/test-deepfire-context.ts
node scripts/test-satellite.cjs
node scripts/test-provider-reliability.cjs
```

Live authenticated Deepfire checks succeeded for all four existing collections. The archive around 41.1842, 1.2381 returned 141 hotspots and five perimeter snapshots over three days. These are thermal anomalies and estimated boundaries, not confirmed fire declarations.

Live Collection 1 processing at 41.73, 1.83 compared `S2A_T31TCG_20260915T103959_L2A` with `S2C_T31TCG_20260913T104809_L2A`: 98.65% valid NDVI/NBR pixels and 98.62% valid dNBR pixels. This verifies data retrieval and computation, not hazard accuracy. Paid job execution has not been exercised; request/state handling is tested with provider fixtures.

## References

- https://docs.deepfire.co/api/hotspots
- https://docs.deepfire.co/api/satellite-perimeters
- https://docs.deepfire.co/api/fire-spread
- https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a
- https://github.com/Element84/earth-search
- https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/ndvi/
- https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/nbr/
- https://firms.modaps.eosdis.nasa.gov/active_fire/

Desktop (1440 px) and mobile (390 px) browser checks rendered the history and imagery surfaces. The browser-generated numeric export was downloaded and checked for its 128 × 128 values, CRS/transform, comparison scene and calibration provenance. The live NOAA-20 sensor route returned six records near Tarragona with the original I4/I5, scan/track and day/night fields.
