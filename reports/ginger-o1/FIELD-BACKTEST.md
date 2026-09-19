# GingerO1 field benchmark

Experimental research result. No operational accuracy claim.

Source: [CSIRO Annaburroo v3](https://data.csiro.au/collection/csiro:60062), Creative Commons Attribution 4.0 International Licence. Gould, Jim; Gomes Da Cruz, Miguel; & Sullivan, Andrew (2023): 1986 Annaburroo Experimental Grassland Fire Data. v3. CSIRO. Data Collection. https://doi.org/10.25919/ycd3-w209

120 eligible fires on 14 burn days; 1 excluded. 699 interval records are used only to join dates, not counted as independent backtests.

| Evaluation (m/min) | Existing grass model MAE | Validation-selected model MAE |
|---|---:|---:|
| Chronological held-out (35 fires, 3 days) | 21.18 | 21.18 |
| Leave-one-day-out (120 fires, 14 folds) | 25.15 | 25.97 |

Training-fitted scale: 0.8; validation rejected the calibration and retained the baseline. Selected scale: 1; fitted on training days only and selected on validation. **Not applied to live simulations.** Test baseline bias: -0.08 m/min; candidate bias: -0.08 m/min. Positive bias means overprediction.

Paired day-bootstrap 95% MAE-reduction interval: 0.00 to 0.00 m/min (3 days; very limited independent sample).

## Boundaries

- Anderson fuel 1 grass proxy, as in the live engine; flat terrain.
- Published derived midflame wind is supplied directly in km/h; no additional 10 m wind adjustment.
- Measured dead-fuel moisture with the live engine minimum of 1%; live moisture held at 90% (fuel 1 has no live fuel load).
- Primary target: observed plot-average ROS × 60, m/min. Derived steady-state RSS is not a target or input.
- Fuel load, height, treatment, curing and ignition-line effects are not resolved by the current fixed grass proxy.
- These retrospective measured inputs are not archived operational forecasts.
- Australian experimental grass fires do not validate Catalan forest, urban ignition, grid perimeters, or building arrivals.

Full splits, excluded IDs, per-fire predictions, candidate selection, cross-validation folds, checksums and metrics: [field-backtest.json](field-backtest.json). Reproduce with `npm run backtest:ginger-o1`.
