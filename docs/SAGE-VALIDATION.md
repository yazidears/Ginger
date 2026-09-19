# SAGE experimental solver validation

Current engine: **GingerO1 0.1.0**. See [GingerO1 evaluation and reproduction](GINGER-O1.md) for the 120-fire grass spread-rate component benchmark, rejected calibration, and separate 16-direction numerical verification. Synthetic tests alone still do not establish operational accuracy.

The engine is a nine-member deterministic sensitivity experiment, not a calibrated probability forecast. Synthetic tests verify implementation properties; they do not establish operational accuracy.

## Corrected during independent review

- Simard equilibrium-moisture coefficients require Fahrenheit. The public Celsius input now converts before evaluating all three humidity branches. Source: USDA Forest Service, *MCFire Model Technical Description*, equations 38–40, https://www.fs.usda.gov/pnw/pubs/pnw_gtr926.pdf .
- Reject invalid terrain, grid, scenario and weather values before simulation; invalid building heights stay unknown.
- Domain/grid descriptions now use actual dimensions instead of hardcoded 2 km / 25 m values.

## Reproducible checks

Run `node scripts/test-sage.cjs`. Checks cover reference moisture equations, drying response, solar projection, slope orientation, coordinate/grid roundtrips, polygon holes and narrow footprint intersections, meteorological wind direction, deterministic ensemble arrivals, bounded forecast times and missing-input rejection.

## Remaining scientific limits

Mapped cover remains an unsurveyed fuel proxy. Moisture and wind adjustment are operator assumptions. Sixteen-direction grid propagation reduces but does not eliminate angular bias. Buildings block surface propagation but are not fireproof; the optional structural scenario uses assumed distance/delay transfers, not physical combustion. Ember transport and crown fire are absent. Radiation is a single-cell unshielded screening estimate, not facade heat transfer. Building arrival means near-footprint surface exposure or assumed structural transfer; ensemble min/max include only members that reach the footprint. The solar moisture approximation lacks rain interception/wetting, material-specific balance and canopy shadows.

Before operational use, require independently verified fuel/moisture inputs, solver benchmark comparisons, retrospective incident validation with held-out events, observed front uncertainty and measured arrival-error distributions. Do not relabel member counts as probabilities or unvalidated times as evacuation safety.
