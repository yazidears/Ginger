# WeatherNext 3 export adapter

This optional authenticated Python job exports actual Google Earth Engine WeatherNext 3 point forecasts for a later server-side ingestion step. It does not configure the application, invent observations, supply mock values, or establish that this account has WeatherNext access. No authenticated retrieval was tested during implementation.

## Access and installation

1. Request WeatherNext allowlist access using the Google account that will authenticate the job. Google documents a typical review period of 5–7 business days. The allowlist applies across Earth Engine, BigQuery and Cloud Storage.
2. Register a Google Cloud project for Earth Engine, enable the API and grant the caller appropriate IAM permissions. Earth Engine noncommercial eligibility must be verified; commercial projects need the corresponding paid setup. A Maps API key alone is insufficient.
3. Use Application Default Credentials (ADC) for the approved identity. Locally, run `gcloud auth application-default login`. This is separate from ordinary `gcloud auth login`. For deployment, use a managed service identity/workload identity whose WeatherNext authorization has been confirmed. Do not commit credential JSON.
4. Install optional dependencies and set the project in the job environment:

```sh
python3 -m venv .venv-weathernext
.venv-weathernext/bin/pip install -r requirements-weathernext.txt
export GOOGLE_CLOUD_PROJECT=your-registered-project-id
.venv-weathernext/bin/python scripts/weathernext-export.py \
  --lat 41.30 --lon 1.80 --steps 24 --output /tmp/weathernext-garraf.json
```

The script reads ADC through `google.auth.default`, not a Maps key or browser token. Google libraries can use `GOOGLE_APPLICATION_CREDENTIALS` where necessary, but managed identity is preferable for deployment. Optional `--valid-at 2026-09-19T12:00:00Z` selects the first available valid time at or after the supplied timezone-aware timestamp. `--steps` accepts 1–48. Default requested valid time is now.

## Verified source and retrieval

Collection: `projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg`.

The script sorts `start_time` descending to discover the latest **initialization**, selects that run, filters `end_time >= requested time`, sorts `forecast_hour`, then samples the point at the documented 10,000 m reduction scale. It does not choose the largest `system:time_start`, which would select the furthest valid forecast instead of necessarily the latest run. A newly ingested run can be incomplete: the output contains only available timesteps, without silently mixing runs. Each remote EE operation has a 60-second deadline.

Catalog-verified base bands (all have `_mean`, `_p10`, `_p25`, `_p50`, `_p75`, `_p90`):

| Output variable | Actual band prefix | Provider unit | Output unit |
|---|---|---|---|
| temperature2m | temperature_2m | K | degC |
| dewpoint2m | dewpoint_temperature_2m | K | degC |
| windSpeed10m | wind_speed_10m | m/s | km/h |
| windU10m | u_component_of_wind_10m | m/s | m/s |
| windV10m | v_component_of_wind_10m | m/s | m/s |
| precipitation1h | total_precipitation_1hr | m | mm |

Band names are checked against the live image before sampling; incompatible schemas fail closed. Temperature converts by subtracting 273.15, wind speed multiplies by 3.6, and precipitation multiplies by 1000. Precipitation is the one-hour accumulation, not an instantaneous rate. Wind-speed statistics are read directly, **not** incorrectly constructed from marginal U/V percentiles.

## Output contract

Root: `schemaVersion: 1`, `status: live | partial`, `source`, `retrievedAt`, `issuedAt`, `requestedValidAt`, `location: {latitude, longitude}`, `forecasts`, `limitations`.

`source` records the provider, exact collection/catalog, `gridResolutionDegrees: 0.1`, sampling scale and `actualBands` returned by Earth Engine.

Each `forecasts[]` contains:

- `issuedAt`: provider's run initialization (`start_time`), not publication time.
- `validAt`: provider's `end_time`.
- `forecastHour`: integer lead time.
- `ingestionTimeUtc`: original provider metadata, retained without assuming a timestamp unit.
- `complete`: whether all selected bands produced finite point samples.
- `variables`: keys in the table above, each with `unit`, `sourceUnit`, `statistics: {mean,p10,p25,p50,p75,p90}`, and `bands` mapping every statistic to its exact source band.

Missing/masked values remain `null`. No complete sample causes failure. Mixed complete/incomplete rows produce `status: partial`. Output uses an atomic file replacement after successful validation; a failed run preserves the previous file. Consumers must independently reject stale `issuedAt`/`validAt`, inspect completeness, and show last successful retrieval time. A file's presence is not a freshness guarantee.

The Python library's authenticated exceptions are not echoed because their messages can contain request details. Failures exit 1 with an access/schema diagnostic; malformed CLI arguments exit 2. No credentials appear in output.

## Validation without access

```sh
python3 scripts/weathernext-export.py --lat 41.3 --lon 1.8 --dry-schema
python3 scripts/weathernext-export.py --help
```

`--dry-schema` requires no optional libraries, credentials or network and returns `status: schema-only`, `liveAccessTested: false`. It is not a forecast. Syntax, argument validation, band count, and unit conversions were locally checked; the account allowlist, ADC, actual collection sampling and integration into the app remain unverified.

## Interpretation and refresh

Use these as regional model inputs. A 0.1° cell cannot resolve slope-driven local winds or camera-scale conditions. Marginal percentile bands are not coherent joint ensemble members; do not combine all p90 values and claim a calibrated 90% fire perimeter. To run correlated weather scenarios, use raw ensemble members from the separately documented Cloud Storage collection. This adapter does not export those members.

Run on forecast availability cadence, not map render or second-level UI timers. Store normalized exports outside public assets and expose only validated subsets through an application API. Respect experimental real-time data terms and attribution. WeatherNext is not an official warning service or validated operational wildfire model.

## Official sources verified 2026-09-19

- [Earth Engine WeatherNext guide](https://developers.google.com/weathernext/guides/earth-engine): collection, properties, scale and filtering.
- [WeatherNext 3 gridded catalog](https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_3_0_0_0p1deg): exact bands, units and experimental-use terms.
- [WeatherNext access](https://developers.google.com/weathernext/guides/access-forecast): allowlist and licensing distinction; real-time/future data uses experimental terms, historical data at least one hour old is CC BY 4.0.
- [Earth Engine access](https://developers.google.com/earth-engine/guides/access): project registration and IAM.

## Application ingestion

Set `WEATHERNEXT_NORMALIZED_FILE` to the absolute path of the successful export and restart the Next.js server. `src/lib/providers/weathernext.ts` reads at most 2 MiB of local regular-file content. No path or credential is returned to the client. The assessment endpoint then adds an optional `weatherNext` object containing `status`, `detail`, `retrievedAt`, and `data`. With no configured path the field is omitted. The existing Open-Meteo weather and SAGE severity rules remain independent; ingesting this export does not imply a fire spread prediction.

Accepted input must be schema version 1 with complete `live` rows, exact collection/provider/catalog identity, all 36 expected band references and units, finite range-checked values, increasing marginal quantiles, a single initialization and chronologically consistent forecast lead times. A `partial` export is rejected rather than being advertised as complete. Only documented fields are returned.

Freshness checks reject initialization more than 12 hours old, retrieval more than 2 hours old, or no valid forecast in the next hour. Future initialization/retrieval beyond five minutes are rejected. A point must match the requested assessment location within 0.001° in each coordinate; this does not make the underlying 0.1° model more spatially precise. For other locations, export a new point. Stale and rejected inputs return `data: null`; they never replace existing weather. The status `live` describes a valid fresh provider export, not independently authenticated access by the Next.js process: the local operator remains the provenance trust boundary. No successful account access has been verified here.
