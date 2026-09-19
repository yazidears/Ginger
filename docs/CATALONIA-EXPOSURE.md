# Catalonia people and infrastructure inventory

Ginger stores a regional OpenStreetMap extract on the Node server. Assessments and watch-area scans read a spatial index without making per-zone requests to Overpass. The map requests only viewport geometry from `GET /api/exposure`.

## Import and refresh

Requires Python 3.10+ and `pip install -r requirements-exposure.txt` in a virtual environment.

```sh
python scripts/import-catalonia-exposure.py --download
```

This downloads the [Geofabrik Catalonia PBF](https://download.geofabrik.de/europe/spain/cataluna.html), assembles node, road and multipolygon geometry using pyosmium, and atomically replaces `.ginger-data/exposure/catalonia.geojson`. An existing PBF can be reused with `--pbf /path/to/cataluna.osm.pbf` and no `--download`. Refresh with the same command; running servers reload when the file changes. The source timestamp comes from the extract header, separately from the import time. Download/import failures preserve the previous inventory. A refresh is an operator command, not an automatically scheduled job.

Set `GINGER_EXPOSURE_FILE` to a shared absolute dataset path if the web server and worker run in different working directories. Otherwise both need the file at `.ginger-data/exposure/catalonia.geojson` under their runtime directory. Copy the finished GeoJSON to the server through a temporary filename and rename it; the PBF and Python are needed only for imports. The generated dataset is intentionally ignored by Git. Keep OSM attribution and ODbL licensing when redistributing it.

## What is mapped

- Education: schools, kindergartens, colleges and universities.
- Healthcare: hospitals, clinics, nursing homes and assisted living.
- Complexes: mapped residential, commercial, industrial and retail land-use areas.
- Roads: motorway, trunk, primary, secondary, tertiary and their links. These indicate potentially important connections; they are not verified evacuation routes.
- Potential busy places: stations, markets, malls, squares, worship/community venues, stadiums, sports centres, theatres/cinemas, conference centres, beaches, hotels, campsites and attractions.

This is the mapped inventory in the regional extract, not a complete official census. Extract boundaries may include cross-border context. Separate OSM objects can represent parts of one facility; counts are records, not verified unique institutions. Untagged sites and unsupported non-area relations may be missing. Occupancy, crowd frequency, capacity, closures and fire arrival stay unknown. Site types indicate potential congregation, not measured footfall.

## Exposure rule v1

For each saved watch circle (or the 1.5 km inspection circle), select geometry in the circle plus a 1 km buffer. Points use local projected distance; roads use nearest segment; polygons use the footprint and preserve holes. Distances use a local equirectangular approximation appropriate to these Catalan queries, not routing distance.

| Category | Points per record inside zone | Category cap |
|---|---:|---:|
| Education | 8 | 16 |
| Healthcare | 10 | 20 |
| Complex | 4 | 12 |
| Road | 2 | 6 |
| Potential busy place | 4 | 12 |

Outside the circle, the contribution declines linearly to zero at the buffer edge. The total is capped at 40. The contribution is applied only when a qualifying weather window or recent thermal observation is present. Missing evidence alone never activates the uplift. These configurable-in-source weights are uncalibrated review rules, not fire or casualty probabilities. The original hazard state is retained; within a state, the watch list ranks by the exposure contribution. The original danger evidence and the consequence proxy remain visible separately.

The record count and score use all matches. The assessment includes only the nearest 100 geometries and the panel lists the nearest 12. The map caps each viewport response at 5,000 records, balanced across enabled categories, and explicitly asks users to zoom in when capped. Map filters never alter scoring.

Inventory status distinguishes missing data, outside extract coverage, extract-edge/skipped geometry, and data older than 30 days. Zero known records does not establish absence of vulnerable assets. Refresh the background monitor/assessment to incorporate a replacement dataset in cached evidence.

## Validation

`npm run test:exposure` checks crossing roads, footprints, courtyard holes, distance decay, category caps, hazard gating, stale/missing/edge coverage and independence of score from display limits. Existing assessment, monitor and intelligence tests check that the hazard rules continue to work.
