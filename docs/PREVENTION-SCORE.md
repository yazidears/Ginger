# Prevention priority

The backend's receptivity refresh now attaches `prevention` to each mapped cell.
`GET /api/receptivity` delivers it alongside `preventionMethod`, including the
reference team and all model limitations. Older saved snapshots gain the fields
on refresh; both the in-process backend and external worker start the 15-minute
refresh loop without requiring a connected browser. A missing input produces `null`, never a misleading low score.

This is a versioned **experimental planning index**, not a calibrated probability
or operational dispatch recommendation. It separates baseline danger from the
modeled benefit of prevention, following the conceptual distinction between
likelihood, fire behavior and effects in the [US Forest Service risk framework](https://research.fs.usda.gov/treesearch/56265).
That framework does not validate the weights or intervention assumptions below.

All output scores use 0–100 points. Calculation (before display rounding):

- `R`: existing FFMC receptivity / 100; `S`: existing ISI spread index / 100.
  Wind is already in ISI and is not counted twice.
- `H`: human activity proxy / 100. Existing distance-weighted OSM contributions
  for roads, residential/work complexes and gathering places total at most 30
  points; divide by 30. This is potential activity, not live people counts.
  A stale, partial, missing or out-of-coverage extract leaves H unknown.
- `G = connectedFuelHa / (connectedFuelHa + 1000)`. Four-neighbour UTM cell
  connectivity sums burnable fractions. This is mapped fuel extent clipped to
  the dataset, **not hectares forecast to burn**. Sub-cell barriers and spotting
  are unresolved; the 1,000 ha reference is an uncalibrated display choice.
- `I = 0.1 + 0.9 H`: relative ignition-source pressure. The background 0.1 is
  an explicit common scenario assumption, not observed lightning.
- `E = coverage × max(0, 1 − arrivalMinutes / opportunityMinutes)`.
- `baselineRisk = 100 R I (S + G) / 2`.
- `residualRisk = 100 R [0.1 + 0.9 H (1 − ignitionReduction E)]
  × (S + G) / 2 × (1 − spreadReduction E)`.
- **`preventionScore = baselineRisk − residualRisk`**: absolute modeled benefit.
  `relativeReductionPct` is the percentage change of this index, not success
  probability. It is null for a zero baseline.

The reference scenario is one hypothetical team with full coverage, arrival now,
a 60-minute opportunity, 50% reduction of human ignition pressure and zero spread
reduction. These values are assumptions, not inferred from assigned tasks.
Coverage represents the fraction of the zone the proposed work can cover;
ignitionReduction describes avoiding ignitions and spreadReduction describes
mitigation work's assumed effect on spread consequences. Neither claims a team
can safely suppress an active fire. A low benefit can coexist with high danger.

## Compare a specific team scenario

`POST /api/receptivity/prevention` performs a read-only calculation using fresh
saved evidence. It accepts a mapped `cellId`, an optional `horizon` (0, 1, 3, 6,
12, 24 hours), the full `team` object, and an optional scenario `humanActivity`
index (0–100). Overrides are labeled `scenario`. It does not persist an assignment.

```json
{
  "cellId": "use-an-id-from-api-receptivity",
  "horizon": 3,
  "humanActivity": 80,
  "team": {
    "coverage": 0.8,
    "ignitionReduction": 0.5,
    "spreadReduction": 0.1,
    "arrivalMinutes": 15,
    "opportunityMinutes": 60
  }
}
```

The response includes baseline and residual risk, prevention score, component
indices, missing inputs, forecast valid time, and the exact assumptions. Unknown
forecast inputs produce an insufficient-data score; stale snapshots return 503.
Comparisons between zones should use the same horizon and team assumptions.
To estimate fire size over time, use a separate spread simulation with verified
ignition, fuel and terrain inputs; this index does not replace that simulation.

Run `npm run test:prevention-score` for model, connectivity and endpoint checks.
