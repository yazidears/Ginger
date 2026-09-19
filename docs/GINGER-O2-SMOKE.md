# GingerO2 wind and smoke illustration

This is a deterministic horizontal transport illustration, not a trained smoke forecast. It does not output PM2.5, visibility, health risk, smoke mass, or concentrations. The pale map shapes must not be read as a safe/unsafe boundary.

## What is implemented

- Wind is meteorological **from** direction; transport uses `(from + 180) mod 360`. Forecast 10 m wind is used directly, including the run's timed wind multiplier/rotation. Surface fire uses its separate midflame adjustment.
- A puff's centre follows `dx/dt = U sin(toward)`, `dy/dt = U cos(toward)`. Integration steps are at most one minute and split at weather-frame and scenario-change boundaries. Missing weather suppresses a trajectory rather than inventing wind.
- Horizontal footprint radius is `sqrt((cellM/2)^2 + 2 K ageSeconds)`, with **assumed** `K = 8 m²/s`. This borrows the diffusion scaling for variance; the rendered circle is an illustration footprint, not a Gaussian concentration contour.
- Only central-member modeled surface arrivals and central-member assumed structural ignition times produce sources. Surface sources emit at two-minute intervals for an assumed 10 minutes; structures for an assumed 30 minutes. Earlier observed-perimeter interiors initialized at zero are not known to be actively burning; their emissions inherit that initialization assumption.
- Each puff is retained for at most 30 minutes. At most 96 regularly sampled source locations are illustrated. Sampling is for rendering and is not mass conserving. Radius growth and opacity are visual parameters, not trained emissions physics.
- Output polygons are clipped against the rectangular simulation domain using polygon-edge intersections; zero-area/tangent results are omitted. Smoke leaving it has not disappeared physically; it is outside the illustration. The requested minute is clamped to the run horizon. There is no autonomous animation; timeline updates control the layer, including for users preferring reduced motion.
- Fire direction is separate: displacement between the centroids of central cells newly reached in two consecutive five-minute windows. Each window must contain at least three cells, the timeline must be at least ten minutes, and the displacement must be at least one grid cell. Otherwise it shows **no clear direction**. This describes a recent front-centroid shift rather than the radial sector relative to the ignition or a future spread guarantee; multiple fronts and changing fuel coverage can influence that centroid. Structural transfer still follows distance/delay assumptions, not wind or combustion physics.

## Scientific basis and limits

NOAA's [HYSPLIT description](https://www.arl.noaa.gov/hysplit/) explains the broad distinction between moving air parcels/puffs and dispersion. The [NOAA HYSPLIT tutorial](https://www.ready.noaa.gov/documents/Tutorial/html/index.html) documents a fully developed atmospheric transport system. Those sources support using transport plus spreading as concepts; Ginger does **not** implement HYSPLIT, share its validation, or reproduce its atmospheric physics.

Missing inputs/mechanisms include vertical wind profiles, plume rise, atmospheric stability, building wakes, terrain-induced airflow, fire-atmosphere coupling, calibrated fuel consumption and emissions, deposition, chemistry and suppression. Finite residence, diffusivity, lifetime and display sampling need observational calibration before any quantitative smoke interpretation. No smoke observations were used for training.

## Reproduce the checks

`npx tsx scripts/test-ginger-o2-smoke.ts`

Tests cover cardinal direction and transport distance, a weather-hour turn, timed scenario rotation/speed change, calm spreading, no pre-ignition sources, finite surface and structural emissions, domain/horizon bounds, absent-weather handling, deterministic sampling and the absence of concentration properties. These are implementation tests, not field validation.
