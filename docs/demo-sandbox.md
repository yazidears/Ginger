# Demo: the real Ginger simulation

`/demo` now mounts the same `SageSimulation` component used by the main prevention workspace. There is no separate demonstration spread model.

1. Select **Click map to ignite** and click a location in Catalonia.
2. The click submits its coordinates and the selected radius, moisture, horizon and structural settings to `POST /api/sage/runs`.
3. The existing worker loads the real landscape and weather, runs GingerO2's nine-member propagation model, and saves its normal `RunState` / `RunResult`.
4. The shared map plays the returned 25 m arrival cells and building exposure results. **Results** opens the existing investigation tools: scenario changes, wind shifts, fuel-removal imports, comparison, exposure and source inspection.
5. **Open this exact run in the main workspace** opens `/prevention?sageRun=<id>`. It loads that saved result, including all inputs, rather than starting another simulation from just the coordinates.

**Place new fire** starts a new run at a new origin. The engine currently models one ignition extent per run; the former demo-only multiple fires and fictitious asset alerts have been removed. A demo ignition is always a hypothetical scenario. It does not declare a real fire or send operational alerts.

The normal backend limits apply, including Catalonia coverage, complete weather, usable land cover, one active worker, and a three-minute budget. Source failures are shown directly, with no fabricated fallback. Changing settings and running again recomputes the actual model.

## Validation

- `npx tsx scripts/test-demo-sandbox.ts` checks that map ignition requests preserve settings, use the actual request validator and produce actual engine outcomes, including structural transfer and changed assumptions. It uses explicit test fixtures for deterministic checks.
- `npm run test:sage` covers surface physics, weather validation, structural spread and footprint handling.
- `npm run test:investigation` covers wind/fuel scenarios, saved baseline comparisons and exposure analysis.
- The local server sync now includes `scripts/sage-worker.ts` and the GingerO2 model artifact required by actual runs.

Local preview: `http://localhost:3003/demo`. The runtime copy is `/Users/yazidears/.cache/ginger-demo-source`, used because iCloud placeholder reads in the working directory can time out. Both `/demo` and `/prevention` on that server share the same SAGE API, worker and saved runs. This is local acceptance, not a deployment to another server.

Browser/worker acceptance: placing a fire created actual SAGE job `64d48627-4edd-49e8-b9d3-d6a1bdb191a8`; its fresh-weather fetch failed with Open-Meteo HTTP 429 and was surfaced as a failure. A subsequent real-worker rerun `2014907b-8748-42fb-acc2-59aa598f1b91` completed from the existing ICGC/OSM/Terrarium/Open-Meteo snapshot dated 2026-09-19 14:26 UTC, using GingerO2 0.2.0, nine members, 25 m cells, 4,830 building assessments and 2 ha of modelled surface spread. This confirms the production worker path using saved inputs; current-weather availability remains dependent on the upstream service.
