# Local acceptance — 2026-09-19

Verified on this Mac; this is not an external production deployment or field validation.

- Persistent app: http://localhost:3002, with a separate LaunchAgent weather worker.
- Live snapshot at 16:44:28 UTC: 29,813 assessed 200 m cells, 18 eligible XEMA stations, observations ending 16:00 UTC, `stale: false`, no refresh error. Counts: no high, very-high or extreme current cells. Higher scores are not manufactured to make the map dramatic.
- Real 31-day observation/history ingestion; MET Norway forecasts serving after an actual Open-Meteo quota rejection.
- ESA WorldCover fuel eligibility, DEM elevation/slope/aspect, and 1,593 cells with sufficient clear Sentinel-2 pixels from 2026-09-16. Other spectral values remain absent.
- FFMC/history/missing-data/staleness/forecast tests and scoped TypeScript checking pass.
- Optimized Next build passed and was started separately on port 3003 for HTTP and browser acceptance with the live worker snapshot. The temporary acceptance server is not the persistent installation.
- Browser inspection confirmed actual map cells, rankings, source status, the SAGE panel, and the +6H score and deterministic explanation update. The concurrently introduced shared-map integration was rechecked on port 3002. Browser automation's normal pointer delivery was ineffective in this session; ordinary DOM button clicks through its documented development capability verified the handlers. No application data was modified for testing.
- Municipal cell-detail API returns real structured assessments for the selected forecast horizon.

## Outstanding scientific limits

The 0–100 transformations and display bands are experimental, not calibrated Catalan establishment probabilities. Weather is transferred from stations, not resolved at 200 m. Terrain and satellite indices are contextual rather than calibrated score multipliers. Soil moisture, ET, live fuel moisture/load and curing are absent. Pla Alfa current comparison is withheld because the public layer's edit timestamp is old; validation against a verified current official danger product and Catalan field outcomes remains outstanding. Mobile interaction acceptance was not completed.

## Follow-up: feature access and repeated scores

Restored explicit home-screen links to Prevention, Inspect, Simulate, Satellite, Replay, Watch areas, Tasks and Alerts, with selected-cell coordinates passed into applicable tools. Existing `/?sageRun=…` links redirect to the operational simulator. The tasks shortcut was verified in the browser and the existing operations records API responded successfully.

The ranking now contains one representative vegetated cell per independent station input, retains legitimate ties across stations, displays the regional score range and labels how many cells share each input. The selected cell explains its station distance and the current lack of modeled local fuel/terrain effects. The FFMC calculation and score values have not been altered to manufacture variation. At diagnosis, the actual regional range was 43–63; only 1,919 of 29,813 assessed cells had score 63.

Full TypeScript checking and the engine tests passed. The new ranking regression check passes with duplicate station cells, independent equal scores, lower scores, rising cells and missing coverage (`node --import tsx scripts/receptivity/test-presentation.ts`).

Follow-up browser acceptance also confirmed the simulator controls and shared map render together, the Receptivity link returns home, and the home screen displays Forest plus the restored tools and the 43–63 regional score range. No simulation was launched and no operations records were created during this check.
