# SAGE investigation

Open **Inspect → Run SAGE → Investigate**. Six compact views share the existing map and forecast timeline.

- **Changes:** compare saved runs on the same grid at a shared absolute time. Coral cells are newly projected; teal cells were previously projected. New building exposure uses the sensitivity envelope. Counterfactual branches also calculate wind, moisture, ignition, fuel removal and solar-drying effects one at a time against the parent. Those full-horizon effects are not additive and are not observational causal proof.
- **What if:** change wind rotation/multiplier/start time, moisture, ignition offset, or import a hypothetical fuel-removal Polygon. A branch reuses its parent's saved landscape/weather. Wind timing uses the solver's 30-minute integration steps. Fuel removal does not simulate suppression effectiveness or ember/crown-fire crossing.
- **Correct:** import a sourced, timestamped Polygon. At that time, compare central projected cells with the observed extent using grid intersection-over-union and missed/extra hectares. A new run initializes burnable cells inside the supplied extent at time zero. This is extent reinitialization, not parameter calibration or an assertion that every interior cell is actively burning. The original remains saved. Observation must fall in the baseline forecast and fit within the domain.
- **Observe:** rank isolated wind direction, wind speed and moisture cases by changed building reach, then maximum timing shift. Map cells show reach or timing disagreement; up to three front-check candidates are separated by 150 m. This is a scenario-sensitivity heuristic, not expected information gain, calibrated uncertainty or permission to enter a location.
- **Exposure:** import sourced infrastructure grouped by settlement or dependency group. Report when at least two different infrastructure kinds in the same group intersect the central projected front. No service outage, graph dependency, population, route capacity or evacuation safety is inferred. Partial-domain assets stay marked partial.
- **Thermal:** collect detections during regional scans and manual refresh, deduplicate observations and retain up to 30 days / 20,000 detections locally. Group within 500 m of a fixed first-detection anchor, within 10 km of the selected location. Count distinct timestamps and days; display peak FRP by pass. Recent detections with increasing peak FRP or wind ≥25 km/h and humidity ≤25% get review priority. Three observed dates mark recurrence, never a confirmed industrial source. Mapped land cover provides context where available. Cross-sensor and changing pixel coverage can affect FRP comparisons; no fire-growth estimate is claimed.

## Imports

Perimeter/fuel-removal files accept GeoJSON Polygon or Feature with Polygon geometry, at most 500 vertices and 64 KB. Rings must be closed; domain checks run before simulation. Use real source references and actual observation times. Fuel removal is a user scenario.

Infrastructure accepts a FeatureCollection of at most 100 Point, LineString or Polygon features. Each feature needs string properties `name`, `group`, `kind`, `source`, `verifiedAt` (ISO timestamp). Source/date are operator assertions; Ginger does not independently authenticate them. The UI provides a template. Infrastructure files remain in the current investigation's browser state; they are not sent to a provider.

## Storage and validation

New simulations save `<id>.landscape.json` next to the run. Older runs remain comparable but must be refreshed before branching. Existing seven-day run retention also applies to snapshots. Thermal observations use `.ginger-data/thermal-history.json`, with serialized writes within a single Node process. This is not a multi-host database.

`npm run test:investigation` covers reproducible branches, isolated attribution, delayed wind shifts, moisture/ignition changes, fuel removal, perimeter reinitialization and fit, domain limits, independent sensitivity, compound exposure, malformed imports and thermal deduplication/recurrence. Tests establish implementation behavior, not wildfire forecast accuracy. See `SAGE-VALIDATION.md` for scientific limits.
