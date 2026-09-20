# Area review priority

The home map defaults to **Area review priority**. The weather tab keeps the existing station-based FFMC/ISI indices. A high dryness index alone never marks an area for review, and the display does not stretch each day's values across a relative colour scale.

`src/lib/receptivity/priority.ts` is the shared, deterministic review policy (`area-review-1`). The browser recomputes it for the selected horizon and every thirty seconds so source expiry does not depend on a successful refresh. The cell API exports `localReview`, including reasons, missing inputs and a suggested next action. The snapshot's existing evidence priority also uses the combined current review policy.

## Fixed screening rules

- **Watch conditions:** estimated fine-fuel moisture ≤16%, mapped fuel fraction ≥60%, neighbourhood continuity ≥70%, plus slope ≥20°, mapped schools/care/complexes/important roads, or recent vegetation dryness evidence. Dry fuel plus wind ≥25 km/h or spread index ≥40 also warrants watch when local context is limited.
- **Review conditions:** the local combination above also has stronger wind, very dry fuel (≤10%) with at least three local factors, recent clear-pixel low NDMI, or a fresh heatwave episode overlapping the selected day. A nominal/high-confidence thermal observation within 1 km independently warrants review.
- **Verify thermal signal:** trusted observations within 1 km include high confidence or observation periods at least ten minutes apart, and dry fuel or mapped infrastructure provides context. This asks for verification; it does not confirm wildfire.
- Low/unknown-confidence observations and signals 1–3 km away remain watch evidence. Large FRP is not independently a confirmation. Individual pixels from the same observation period cannot establish repeat detection.
- **No combined trigger** applies only with fresh weather and thermal feed, current infrastructure inventory, and mapped slope. Otherwise absent triggers are **Evidence missing**. Positive supported triggers can remain visible alongside missing inputs.

These cutoffs are explicit experimental review rules, not scientific calibration, ignition probabilities, physical spread predictions or dispatch instructions. Mapped terrain/fuel and infrastructure provide context; occupancy, actual ignition source and field conditions remain unknown. Negative NDMI is a spectral screening signal, not a measurement of fuel moisture.

## Freshness and grouping

Weather observations expire at 90 minutes; forecast issue age at six hours, and selected forecast valid time must not already be past. Satellite feed age is limited to thirty minutes and acquisition age to six hours. Future, demo, invalid-location and duplicate source/time/position records are excluded. Numeric confidence is interpreted only for MODIS's documented 0–100 scale; other numeric scales stay unknown. The same rule filters map detection markers.

Vegetation evidence requires ≥50% valid pixels, valid NDVI/NDMI and an acquisition within ten days. Heat episodes require a retrieval within two hours. Exposure uses the existing geometry-distance inventory within the cell radius plus 1 km, requiring ready coverage and source age ≤30 days. A snapshot lacking that inventory reports it as missing until the next worker refresh.

Nearby thermal records are grouped within 1 km of the group's first record. Trusted corroboration is restricted to observations within 1 km of the assessed cell. Other actionable cells are grouped into fixed 2 km UTM neighbourhoods. Areas show the strongest representative cell and the total flagged mapped fuel extent, **not predicted burned hectares**. Within the same review level, thermal evidence leads, followed by proximity to that signal, mapped care/education/residential exposure and the number of local supporting factors. These are review ordering rules, not a numerical risk model. The list shows up to 40 areas; all classified cells remain on the map. Forecast controls change environmental assessment while thermal detections retain their actual acquisition time.

NASA explains why detection confidence matters and why thermal detections need interpretation: [FIRMS confidence](https://forum.earthdata.nasa.gov/viewtopic.php?t=5182) and [active-fire caveats](https://forum.earthdata.nasa.gov/viewtopic.php?t=5188). Ginger's spatial, timing and review thresholds above are implementation choices, not NASA thresholds.

## Verification

Run:

```sh
npx tsx scripts/receptivity/test-priority.ts
npx tsx scripts/receptivity/test-presentation.ts
npx tsx scripts/receptivity/test-environment.ts
npx tsx scripts/test-prevention-score.ts
npx tsc --project tsconfig.receptivity.json --noEmit
```

Tests cover identical weather with different local context, uniformly dry days without invented hotspots, stale inventory/weather/forecasts, low/unknown confidence, copied IDs and same-pass pixels, repeated observation periods, expiry/future/demo suppression, spatial grouping and current evidence at future horizons. These tests verify policy behavior, not real incident detection accuracy.
