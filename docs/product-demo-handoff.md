# Three-product implementation and demo handoff

Verified locally on 19–20 September 2026. This is implementation/runtime evidence, not predictive validation or a deployed-production claim.

## Running build and reproducible path

The final production preview is http://127.0.0.1:3051. Development is on port 3050. Both run from `/Users/yazidears/.cache/ginger-product-runtime`, because macOS repeatedly evicted/offloaded files in the Documents checkout and produced read timeouts. Product sources were copied back to `/Users/yazidears/Documents/ChatGPT/Ginger` and checked by SHA-256; see `artifacts/product-verification/repository-sync-verified.json`. Existing unrelated dirty work was preserved. The pre-edit source checkpoint is `/Users/yazidears/.cache/ginger-checkpoints/20260919-product-source`.

Open `/sage?sageRun=abf18558-b5a8-45c5-ad02-5cca49c65148&minute=0`. Choose **Terrain reveal**, enable **Forest**, then **Play**. Pause, scrub, or select NOW / +30m / +1h / +2h. **Inspect** opens one drawer for consequences, forest, assumptions and specialist capabilities. Cyan outlines denote exposed asset geometries; orange denotes the central fire projection. Sensitivity members are not calibrated probabilities. **Overview** restores spatial context. Navigation contains exactly Prevent, Sage and Ash; Home Watch remains separate.

The pinned run is an explicitly hypothetical ignition near Sant Cugat at `[2.089175, 41.431863]`, with scenario origin `2026-09-19T20:00:00Z`, scenario `d10f30b3-d00e-4945-8a72-b8ea45d0b811`. It is preserved with its landscape and immutable exposure sidecars and excluded from ordinary retention. Its environmental evidence is historical/stale; it is not a current incident. No live-data fallback secretly loads this run.

Prevent context URL: `/prevent?scenario=d10f30b3-d00e-4945-8a72-b8ea45d0b811&sageRun=abf18558-b5a8-45c5-ad02-5cca49c65148`. The current assessment correctly reports unavailable fresh weather/thermal evidence, rather than displaying an all-clear. **Explore in Sage** stores location, evidence, assumptions and time. Original matching hourly forcing is captured server-side; unsupported time coverage blocks calculation.

Ash URL: `/ash?sageRun=abf18558-b5a8-45c5-ad02-5cca49c65148&minute=120`. Enter an operator name and the configured operator access token, select/open the run room, then Start voice. A second participant joins its shared room link with operator access and chooses Listen to room while the first participant holds the voice floor. Room/member credentials and OpenAI keys must remain private. The actual browser WebRTC and peer-audio paths passed a two-tab synthetic-speech exercise. The physical microphone/speaker and separate-device checks remain pending; see the limits below.

## Connected calculations

- XEMA observations and FFMC-derived fine-fuel moisture feed Prevent assessment and the immutable scenario. Matching hourly Open-Meteo/MET forecast values supply Sage forcing, preserving intervals and issue identity.
- Prepared terrain/fuel geography informs Prevent; Sage obtains supported landscape-resolution terrain/fuel for propagation. Sentinel vegetation indices contribute only to supported review rules. Soil moisture is distinct and inspection-only.
- Missing direct/diffuse radiation remains null and prevents solar-drying mode; it is never silently zero-filled. Live fuel moisture is a visible assumption where not measured.
- Sage arrival cells and sensitivity members drive geometry-based, time-indexed infrastructure exposure. Building/complex identities are deduplicated. Road segments remain segments, not distinct roads or official closures.
- Real LiDAR crowns are instanced in the same map at the selected scenario. Acquisition dates, coverage and display limits are disclosed. Crown shapes are illustrative; no independent per-tree burn physics is claimed. The specialist ELMFIRE engine retains a separate identity and shared scenario context, not a claim of coupled physics.
- Ash's authenticated server tools retrieve the selected run/time, exposure, incident evidence, comparisons and history. Proposed reports, tasks and new runs require a separate explicit approval. No evacuation/dispatch/public-message tool was added.

See `integration-matrix.md` for source-by-source consumption and blockers.

## Observed verification

- Final Next production build and TypeScript passed. Shared-map, Sage physics/structural, exposure, receptivity, product-context, incident-context, playback, Ash-room and audio-lifecycle checks passed during implementation.
- Real Prevent context POST returned 201; the pinned Sage job completed in approximately 31.5 seconds including landscape preparation. Reported solver computation was 268 ms. Its 120-minute output contains 1,443 mapped buildings, 1,221 known heights, 19 centrally reached buildings at the final minute and 0.6875 ha central cell area. The initial 50 m ignition-radius assumption explains 15 buildings already reached at NOW. This is a small computed scenario, not an artificially enlarged fire.
- Browser playback, 2D/3D terrain, LiDAR, run selection, timeline and final exposure counters were checked. A final regression fix prevents layer/state changes from interrupting Terrain reveal; a single reveal from the 2D overview reached zoom 15.2 with 1,723 displayed crowns. The scene displayed roughly 1,723–1,737 real crowns with a visible partial/display-limit label.
- Actual demo-machine sample: 1,128 requestAnimationFrame callbacks over 10.0006 seconds; p95 interval 16.6 ms; no interval over 50 ms. Separate ten-second WebGL draw-submission instrumentation observed 255 frames (25.49/s), p95 render interval 133.3 ms. The demand-driven map is not continuously redrawn at the monitor callback rate. These measurements do not establish sustained 60 GPU-completed frames/s. Playback clock is elapsed-time based, independent of those rates. Instrumentation restored the original WebGL methods.
- Two authenticated HTTP participants passed 13 checks against real saved runs: shared context/events, exposure, authorization/origin checks, idempotence, exclusive voice floor and release. No operational writes were approved.
- A real OpenAI Realtime provider session invoked incident_status against saved run `f2f68d3d-da0d-4c58-9872-369a2eded87e` at +30 minutes, produced 583,200 bytes of spoken audio, and published the grounded tool event to a second authenticated client. This was a server WebSocket provider check using issued ephemeral credentials, not a browser WebRTC microphone test.
- On 20 September, two actual Chromium tabs connected through browser WebRTC to OpenAI and through peer WebRTC to each other. A 10.13-second generated speech clip triggered VAD, incident_status, the correct run/+30/hypothetical spoken answer and shared events. The listener decoded both the caller (peak RMS 0.2673) and Ash (peak RMS 0.1720 after 15 seconds). Mute, explicit interruption, cleanup, floor-loss disconnection and reconnection passed. The physical microphone was replaced with a labelled fixture and speakers were silenced. See `ash-browser-acceptance.md` and `artifacts/product-verification/ash-browser-webrtc.json`.
- A real screen recording and still frame are in `artifacts/product-verification/`. The recording is cropped to the application viewport; no model output or motion was synthesized.

## Remaining acceptance limits

Actual browser transport, generated spoken input, decoded peer audio, explicit interruption and reconnection have passed. Physical microphone capture/permission UX, human-audible speaker routing, natural spoken barge-in and separate-device/network acceptance remain unverified. The user deferred the physical check while sleeping; no physical microphone was opened. Unit checks cover microphone denial, pending-permission cancellation and cleanup; they do not replace physical acceptance. TURN must be configured for reliable team audio across different networks. Room storage is single-host and is not a multi-tenant deployment.

LiDAR depends on the existing external forest service and the local authenticated tunnel on port 8788. Its prepared coverage is limited; the pinned location is inside it. The existing VM has a scheduled stop on 20 September, so verify availability before presentation. Live environmental freshness depends on refreshing the prepared data; these preview servers deliberately run with the independent ingestion worker disabled.

The machine displayed a macOS application-memory warning during evidence capture. Browser interaction remained usable, but the clean build alone is not a guarantee of stable presentation under current host memory pressure. No unrelated application was force-quit.

Supported model comparisons remain in specialist/scenario tooling; no new side-by-side geographic comparison animation was accepted. The optional console operations feed is not completed. No physical intervention benefit, official closure, actual damage, population exposure or predictive accuracy is inferred from these tests.

## Product continuity follow-up

Prevent now resolves a saved Sage run without requiring a separate scenario query parameter, restores its assessed cell and environmental horizon, and focuses that location. Its selected-area drawer includes a saved consequence summary at the retained model minute, with the exact forecast return link. The summary labels historical/hypothetical output separately from current environmental evidence, and distinguishes building footprints from facility/area counts that may overlap. It disappears when inspecting another cell.

Unavailable Sage exposure now says unavailable rather than remaining pending or suggesting no intersections. Prevent explains that Reload fetches the stored snapshot, skips unsupported hours during playback, and closes layers/assessment with Escape. Missing saved context has an explicit recovery message.

Verified: run-only URL restored Sant Cugat; resume opened the same run at +30 minutes; product navigation returned to that assessment. Shared-map, forecast-exposure and receptivity checks passed; production build passed. Physical voice acceptance remains deferred.

## Environmental refresh follow-up — 20 September, 00:14 Madrid

The current demo runtime was refreshed successfully at 2026-09-19T22:14:10Z. All 29,813 mapped cells have station-supported assessment using 18 valid XEMA stations; observation time is 21:30Z. Open-Meteo forecast and Deepfire thermal feeds refreshed successfully. This supersedes the earlier statement that the current environmental snapshot is stale. The pinned Sage run remains explicitly historical and unchanged. Pla Alfa and parts of heatwave evidence remain stale/partial; the health indicator now reflects partial source availability even when weather is fresh.

A new hypothetical context at the pinned location captured 26 hourly forcing frames and derived dead fine-fuel moisture 16.83%. This verifies current environmental handoff, not a new propagation run. Context id c89db235-689a-4bee-96c2-973cb3c61a44.

The existing background worker serves a different cache directory. This was a one-off refresh of the authoritative product runtime, not a claim of continuous ingestion. Before a later demo, from `/Users/yazidears/.cache/ginger-product-runtime` run `NODE_OPTIONS=--max-old-space-size=1024 npm run refresh:receptivity`, then check the displayed timestamps. The refresh entry point now loads local provider configuration before importing the engine. No physical microphone was opened.

## Continuous environmental refresh

A dedicated serial refresh worker now runs from the current product runtime, independently of the older cache runtime worker. Start command: `NODE_OPTIONS="--max-old-space-size=1024 --conditions=react-server" node --import tsx scripts/receptivity/refresh.ts --watch`. Start only one for this runtime. Each completed/failed attempt is followed by a 15-minute wait; failures preserve the original dated snapshot. SIGINT/SIGTERM stops the wait immediately, or lets an active refresh finish atomically before exit. This is a foreground process, not an installed login/boot service; restarting the computer requires restarting it.

Verified first publication, graceful termination (exit 0), and restart. Observed RSS after the first cycle was approximately 432 MiB; the Node heap is capped at 1 GiB. Log: `artifacts/product-verification/environment-worker.log`. TypeScript and receptivity checks passed. Browser inspection confirmed live review reasons and a saved forecast summary disappearing when a different area is selected.

## Forest availability and exposure review

Production browser inspection displayed 1,731 measured LiDAR crowns in the pinned terrain scene. A labelled, temporary browser-only 503 response for `/api/forest/trees` verified that Sage removes crowns, reports unavailable coverage, and explains that blank coverage does not mean no trees while retaining forecast controls. The original browser fetch function was restored and a subsequent full reload removed all instrumentation. Real crowns loaded again.

Fixed: switching Forest off while its drawer was selected now clears the old forest status/tree selection and returns to consequences. Prevent review reasons now call road inventory objects road segments. At +120 minutes, the pinned forecast displayed 19 reached building footprints and the residential complex selection retained its partial-coverage/no-confirmed-damage explanation. TypeScript, immutable product-context integration tests, and production build passed.

## Multi-zone and satellite follow-up — 20 September

Prevent now offers 104 searchable geographic groups from the actual mapped cells. These are navigation groups, not municipality-wide risk claims; choosing a group selects its highest-priority mapped cell. Searching Terrassa, selecting its forest cell, and restoring that selection after satellite inspection passed in the browser.

The selected-area action **Satellite imagery & vegetation** opens Sentinel-2 imagery at the exact cell centre. The original tile overview remains visible after NDVI/NBR analysis; its caption distinguishes the whole tile from the 2.56 km analysis window. A real 15 September scene at Terrassa returned 99.25% valid land pixels, mean NDVI 0.676 and NBR 0.449. These are spectral condition indices, not species identification, fuel composition, fuel moisture, or confirmed burn severity. Return to selected zone restores the cell and environmental horizon.

A second pinned hypothetical forecast is available through the named Sage scenario chooser: Pallejà, run `c0992c05-64a5-443c-ba8c-2c2783a6ae2a`, scenario `102a880c-cf3d-482e-8e4f-288ff2d3e438`. Its two-hour central result is 1.5625 ha and zero reached building footprints, with 701 mapped buildings and 86% fuel coverage. Both Pallejà and Sant Cugat appear by place name; the second run and its immutable sidecars were copied to the Documents checkout. Browser selection loaded the correct saved map and timeline.

The current explanation provider is OpenAI (`gpt-6-astra`). Nebius adapter code exists but no Nebius key/model is configured in this runtime. Mastra is not installed or used. Ash uses OpenAI Realtime directly.

TypeScript and the production build passed after these changes. On the subsequent continuation, the preview and refresh processes were absent, so both were restarted as detached local processes with 1.5 GiB and 1 GiB Node heap caps respectively. These are still not login/boot services. HTTP verification returned the second run in `completed` state and a non-stale environmental snapshot at 2026-09-20T06:08:29.428Z. Provider availability does not establish physical audio acceptance; the deferred human microphone/speaker and separate-device checks remain outstanding.

## Integrated terrain wind, crown exposure, and operational Ash

Sage now has an explicit **3D terrain wind & fire** mode (`engine=terrain-wind`). It mounts the existing ELMFIRE/WindNinja landscape with the captured parent scenario, rather than silently mixing engines. Primary Sage exposure and Ash still refer to the parent Sage run. Completed terrain run `c41b7bf820e449178dc73fdd3dd3caa1` contains nine members, 400 resolved wind vectors and 26 mapped crown centres inside the arrival footprint (5 reached by +60, 26 by +120). Trees stay visible during Fire playback. Amber/dark colouring represents grid arrival at crown centres, not individual combustion or observed damage. Main Sage crowns likewise use central-member arrival cells. Wind markers animate along real resolved directions, bounded to 20 updates/s, paused when hidden/reduced-motion; trails are schematic and shown through crowns for visibility. This is a fixed-height terrain field, not volumetric CFD.

Changing terrain inputs hides obsolete output and offers Restore computed inputs. Missing local crowns remain missing with a Prepare LiDAR action. Both engines retain supported 1/2/4-hour limits; primary timeline now exposes Change duration and running again is required. Contextual primary Sage notices use actual central asset arrivals, including road names when the computed inventory contains them; no B-24/50-minute example is fabricated. Inspect opens the matching exposure.

Ash now performs a silent initial tool lookup before speaking, uses place names rather than internal identifiers, and separates final-horizon totals from selected-minute exposure. Two real provider checks verified a natural Palleja greeting and a substantive answer using incident_status then asset_exposure at +30 minutes. The user screenshots demonstrate a live voice UI/transcript; physical speaker audibility is still not independently confirmed. Existing sessions must End audio and Start voice after update to receive new instructions.

Validation: production build and TypeScript; primary and ELMFIRE crown-arrival tests, notice selection tests, room/auth/time-scope tests, audio lifecycle tests. Browser verification exercised integrated mode, saved terrain result, playback, actual inventory, primary asset-notice inspection and duration entry.
