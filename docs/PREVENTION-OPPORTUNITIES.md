# Prevention opportunities

`/prevention` (linked from the home map layer menu) and Prevent → Opportunities show watch-area centre points and a ranked list alongside the existing Risk, Detections and Changes views. A point opens the local intervention plan. The list is the keyboard-accessible equivalent of the map points.

The preliminary 0–100 index sums evidence coverage (30), identifiable checks (40), and forecast lead time (30). These are explicit product weights, not learned or validated estimates of preventability, ignition probability, loss reduction or intervention effectiveness. No changes are made to existing hazard scores.

- Coverage: 15 each for fresh weather and satellite evidence.
- Checks: 25 for mapped education/care/building-complex features; 15 for roads/gathering places. Counts do not amplify the score. Mapped infrastructure does not prove a defect or preventable ignition source.
- Lead time: 10 for less than two hours before the configured weather window, 20 for two to six, 30 for six or more. An ongoing or unknown window adds zero.

The total is withheld when weather, satellite or a ready infrastructure inventory is missing or stale. Recent thermal detections also withhold it and direct the user to verification. Zero detections does not establish that no fire is present. Unknown feasibility and effectiveness remain explicit even when a score is available.

Suggested checks cover zone monitoring, infrastructure inspection, and reviewing patrol attention when a weather window and mapped access/gathering features are present. These produce the existing inspection proposals and checklist tasks; they do not dispatch patrols. Location plans recalculate from the assessment, so their smaller geographic radius can differ from a watch-area score. Previously cached plans are rebuilt client-side from their assessment to include the new actions, and task creation revalidates server-side as before.

Run `npm run test:prevention` for score guardrails and the isolated task workflow.
