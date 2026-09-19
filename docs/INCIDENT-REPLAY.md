# Incident replay and sequential evaluation

Open `/replay` or choose **Replay** in the main workspace. Run the synthetic example, import a case JSON, scrub through observation times, inspect forecast errors/member agreement, and export the complete result. Saved jobs remain available for seven days.

## Implemented computation

The existing GingerO2 physical solver runs three fixed wind-direction hypotheses (-30°, 0°, +30°), each containing its nine wind/moisture sensitivity members. This produces 27 frozen arrival-time fields from the same terrain, fuel, initial perimeter and weather snapshot. No current weather is fetched. No likelihood or physical parameter is fitted to the replay targets.

At each observation target, eligible earlier observations update the weights. Eligibility requires both an earlier acquisition and an `availableAt` strictly before the target acquisition. Updates are processed in availability order. The target is scored before it can affect any later forecast; changing its geometry cannot affect its own predictions. This is a sequential hindcast evaluation, not an independent test of a separately trained model.

Weighting uses missed-positive and excess-negative fractions outside each reference boundary's uncertainty band, a fixed tempering coefficient of 4, log-space normalization, and a 2% uniform mixture. This is generalized evidence weighting, not a calibrated Bayesian posterior. The same frozen trajectories are reweighted: this release does not restart fire growth from assimilated perimeters, estimate new fuel states, or implement spotting/crown/structural physics. Effective sample size is `1 / sum(weight²)`.

## Metrics

Both the uniform baseline and updated forecast use a 0.5 member-agreement threshold for the displayed burned mask. Reported metrics include intersection-over-union, precision/recall, missed/excess hectares, mean and 95th percentile symmetric distance between raster boundary-cell centers, Brier score, class-balanced Brier score, and reliability-bin counts. Exact separable Euclidean distance fields are used on the bounded grid. Metrics score the full observation mask; the uncertainty band only affects evidence weighting.

Arrival timing is interval-censored: successive cumulative perimeters constrain arrival to `(last absent, first present]`. The weighted median predicted arrival is scored by distance outside that interval. Initially burned cells are excluded; cells without a predicted arrival and cells not yet observed burned are counted explicitly rather than assigned arbitrary times. Shrinking observed areas generate a warning. These interval diagnostics are separate from the next-boundary prediction scores.

## Data and provenance

Download `/api/replay?template=1` for a complete import example. The included **A fire across the ridge** case has constructed terrain/weather and independent analytical ellipse perimeters. It is explicitly synthetic, and its results must not be presented as historical validation.

A version-1 case contains `id`, `eventId`, `name`, `kind` (synthetic/historical), `split` (train/validation/test), `origin`, a full existing `Landscape`, a surface-only `RunRequest`, provenance and 2–16 later polygon observations. Each observation supplies `at`, `availableAt`, `source`, `uncertaintyM` and `geometry`. Times require timezone offsets. The initial sourced perimeter must be at origin. Later observed perimeters must lie fully inside the domain. Grid size is bounded to 8–80 cells, 10–100 m resolution, at most 4 km across. Uploads are bounded to 3 MB.

For archived forecasts, `weatherIssuedAt` must be at or before origin. Reanalysis and observed-weather cases are labelled retrospective hindcasts. Provenance is user-supplied, not independently authenticated. Input hashes, settings, source labels, every forecast grid and every weight vector are retained in exports. Unknown/nonburnable and building cells retain the existing solver's behavior.

## Runtime

`POST /api/replay` accepts a case, or `{ "demo": true }`; it starts one bounded child process and returns 202. `GET /api/replay/:id` returns progress/result; `?download=1` exports the completed report. `GET /api/replay` lists recent jobs. Inputs and results live in `.ginger-data/replays` (override `GINGER_REPLAY_DIR`). One replay runs at a time, with a 175-second worker kill deadline and a three-minute stale-job cutoff. This needs a persistent Node host, like the existing simulation workers.

## Reproduce

```sh
npm run test:replay
npm run backtest:replay -- cases.json report.json
```

The offline suite prevents incident IDs crossing splits, preserves failed cases, and aggregates event means separately by synthetic/historical kind, split and weather type. It performs no tuning and makes no calibrated probability claim. The integration tests exercise actual physical computation; numerical tests cover distance metrics, non-arrivals, normalization, input validation, delayed availability and target/future leakage.

No independently sourced historical incident package was added in this change. Historical accuracy requires complete archived case inputs and later reference perimeters; the existing CSIRO grass-speed benchmark is not a substitute for those observations.
