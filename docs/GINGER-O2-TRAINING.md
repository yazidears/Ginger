# GingerO2 grass training

GingerO2 adds an **experimental learned grass head-spread-rate component**. It does not train smoke, building ignition, forest spread, local airflow or evacuation timing. The physics model remains the fallback.

## What improved

We fitted a small monotone model from two inputs already available in the simulation: midflame wind and dead-fuel moisture. More wind can only increase its head spread rate; more moisture can only decrease it. It estimates speed along the head of the fire, not a new wind direction. Existing terrain/wind geometry controls direction.

The final formula, in m/min, is:

`exp(2.189364156344018 + 0.8148869962933463 * log1p(midflameWindKmh) - 0.27849299617647566 * deadMoisturePct / 10)`

The fitted coefficients are stored in `data/ginger-o2/grass-model.json`; the runtime imports that artifact. No manually selected multiplier or target-derived fire geometry is used.

## Evaluation and its limits

The source is [CSIRO Annaburroo experimental grassland fires, version 3](https://data.csiro.au/collection/csiro:60062), CC BY 4.0. Attribution: Gould, Jim; Gomes Da Cruz, Miguel; & Sullivan, Andrew (2023), DOI 10.25919/ycd3-w209. There are 120 eligible fires on **14 distinct burn-day groups**, from one Australian site in 1986. Interval records only identify dates; they are not counted as extra experiments. Excluded IDs and reasons are retained in the full report.

This dataset was already examined for GingerO1, including its 35-fire chronological holdout. **These are reused observations, not a new external holdout.** No new independent Catalan validation has been obtained.

Before running evaluation, the candidate family and six ridge strengths `[0, .001, .01, .1, 1, 10]` were recorded in `data/ginger-o2/protocol.json`. Each outer fold holds out one complete burn day. Within the other 13 days, inner leave-one-day-out validation selects regularization using equal-day MAE. Each fit minimizes equally day-weighted squared log error with nonnegative wind and nonpositive moisture coefficients; the intercept is unpenalized. There is no target normalization fitted across folds and no use of derived steady-state RSS, head width, flame height, treatment or measured fuel load. The candidate family was not revised after seeing scores.

| Outer evaluation, 120 fires / 14 folds | O1 physics baseline | O2 candidate | O2 with support fallback |
|---|---:|---:|---:|
| MAE, m/min | 25.15 | 17.04 | 20.41 |
| RMSE, m/min | 35.14 | 21.28 | 30.09 |
| Bias, m/min | -9.93 | -7.63 | -8.42 |
| Equal-day MAE, m/min | 24.70 | 16.42 | 19.12 |
| Within a factor of two | 75.0% | 97.5% | 92.5% |

MAE means average absolute error in spread speed, not arrival time. Negative bias means underprediction. The raw candidate reduces average error 32.3%. **The guarded policy used for live integration reduces it 18.9%.** Seven outer-fold observations are outside that fold's training support and therefore use the baseline in the guarded column.

A deterministic 2,000-replicate paired burn-day bootstrap gives a 95% MAE-reduction interval of **1.42 to 14.23 m/min** for the raw candidate, and **-0.46 to 9.90 m/min** for the guarded policy. The guarded interval crosses zero: the evidence does not establish a reliable deployment improvement. These intervals describe variability across this small set of days, are conditional on the cross-validated predictions, and are not individual-fire prediction intervals or a complete uncertainty estimate.

The final deployment artifact is fitted on all 120 observations, with regularization selected through full-data leave-day-out validation (lambda 0 selected). Its training fit is not claimed as test performance. The scored outer-fold models never train on their test day.

## Runtime boundary

`predictGingerO2Grass` returns `null` unless fuel is grass proxy `1`, inputs are finite, midflame wind is **2.16–25.2 km/h**, and dead moisture is **0.7–12.1%**. Bounds are marginal training minima/maxima, not proof that every combination inside the rectangle is supported. The caller must additionally require explicit experimental opt-in, mapped grass (not crops or urban cover), and near-flat terrain. Geography and fuel-composition transfer remain unvalidated even inside numerical bounds.

The caller may compare the returned speed with a flat Rothermel reference to adjust directional spread. This does not supply a fireline intensity or heat model. Do not infer radiant heat from its fitted speed. Outside the supported conditions the baseline must remain available, with that fallback visible to the user. Do not extrapolate this component to shrubs, forest or building ignition.

## Reproduce and inspect

From the repository root:

```sh
npx tsx scripts/train-ginger-o2.ts
npx tsx scripts/test-ginger-o2-grass.ts
```

Training validates source CSV SHA-256 checksums. The report records source provenance, protocol, exclusions, every outer prediction, training-day membership, inner regularization scores, fitted coefficients, code hashes and artifact hash. Training is deterministic and does not call external services. See `reports/ginger-o2/grass-training.json` and `data/ginger-o2/grass-model.json`.

The next decisive improvement is evaluation on a new independent grass-fire dataset and then regional fire perimeters using archived input conditions. More repeats of these same 120 fires cannot supply that missing evidence.
