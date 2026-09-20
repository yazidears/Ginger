# What the last 15 Ginger tasks delivered

Reviewed 19 September 2026. These are the 15 most recent other Ginger tasks returned by the app, excluding unrelated projects. The table reports their saved outcomes; it is not a fresh end-to-end certification of every feature. There is no Entire checkpoint history in this repository.

| Task | What changed in practical terms | What was still missing in its saved outcome |
| --- | --- | --- |
| [1](codex://threads/01a0ba3e-bd97-7961-8418-f517d982ce51) | Started Ginger in Safari, then patched the running app to accept precise coordinates. | Fix initially existed in source but the older running copy needed a separate patch. |
| [2](codex://threads/01a0ba27-0054-74b1-87bf-69e20592fb32) | Added an iMessage integration with WATCH, STATUS and STOP commands and saved subscriptions. | Live messaging still needed Photon credentials and Nebius configuration. Passing integration tests did not mean messages were being sent. |
| [3](codex://threads/01a0ba2e-2c66-7830-9d6b-a14cd33ec58a) | Removed the simulation intro card and empty timeline; tucked away settings and results; kept Run simulation visible. | Only syntax verification was reported, not a browser check. |
| [4](codex://threads/01a0ba29-a7fb-77d2-ba10-be115ab36c7b) | Added satellite fire history, sensor readings, Sentinel-2 vegetation analysis, downloads and Deepfire simulation controls. | Verified on a separate preview at port 3018. Paid simulation execution was untested. This review found /satellite missing from the main server at port 3002. |
| [5](codex://threads/01a0ba20-e633-77a2-b702-13d93469da66) | Configured Ash speech services and installed an iPhone update with better connection failures. | Real speech generation/transcription worked, but the iPhone/AirPod microphone and playback check remained open. Unmute was not deployed. |
| [6](codex://threads/01a0ba23-b281-7dc3-badf-a90b9e3e3e32) | Added replay experiments comparing 27 possible fire trajectories against observations, with playback and error measurements. | Preview was on port 3017. Reported accuracy improvement came from a synthetic example, not independent real-fire validation. |
| [7](codex://threads/01a0ba05-47ba-7ab0-b520-4c48beaef442) | Set up the main local app and a background worker; prepared six watch areas; made them restart automatically. | Works while this Mac is available. The running copy lives outside the project and must be updated explicitly. |
| [8](codex://threads/01a0ba20-7534-74c0-ad38-6b660dcde5f0) | Discussed a larger prevention workflow connecting evidence, protected assets, inspections and completed work. | Latest saved turn contains planning updates and no final implementation result. Do not count the proposal as a shipped feature. |
| [9](codex://threads/01a0ba21-a397-7183-9857-baf5392d0101) | Added a FireScope research-risk map layer and links to Watch Duty and Focs.cat. | External-map alerts were not imported. Verification used a separate preview at port 3016. |
| [10](codex://threads/01a0ba01-06d6-7133-b9d8-dce0d5fcd718) | Started a Nebius adapter and a panel for asking questions about a simulation. | Mocked checks passed; live activation and browser verification were pending. A credits form was left for the user. |
| [11](codex://threads/01a0ba1c-44db-7f71-9cdf-a38f7cf711be) | Fixed simulation navigation, overlapping panels and keyboard focus. | Verified on a separate preview at port 3003; a preview fix is not proof the main running copy received it. |
| [12](codex://threads/01a0b9fd-89ab-7952-8362-292923dba738) | Wired Simulate to start at the selected point, show progress, then play the completed spread with pause/replay/scrubbing. | Uses the existing experimental simulation model. |
| [13](codex://threads/01a0b9f8-e6b6-7041-8e74-c388509d02e4) | Increased building coverage and allowed hypothetical building-to-building and vegetation spread. | Structural spread uses editable assumptions, not validated building-combustion physics. |
| [14](codex://threads/01a0b9b6-5bf3-76e1-8295-eabf0f9ebdc2) | The latest follow-up restarted a stopped server and confirmed Ginger loaded again. | That follow-up was availability repair, not a new capability. |
| [15](codex://threads/01a0b9ae-524f-73d1-9341-7623bc9a7adc) | Added investigation tools under SAGE, including scenario branches, correction checks and retained thermal history. | Forecasts remain experimental; perimeter/infrastructure analysis needs sourced imports. |

## Why this was hard to understand

Work was split between UI fixes, working local features, configuration scaffolding and future plans. Several features were demonstrated on separate ports without updating the main app. The main update script copied application source but omitted Satellite's Python processor. The Satellite screen also exposed long technical explanations before useful results, and offered playback even when the archive was empty.

## Repairs in this task

- Updated the main server from current source; /satellite now returns HTTP 200 rather than 404.
- Fixed the update script to include the satellite image processor and its dependency manifest.
- Open Satellite on recent imagery, with a real Sentinel-2 image preview and one analysis action.
- Fold source explanations, formulas and coverage detail into expandable sections.
- Hide history playback when there is no history; offer imagery or a longer search instead.
- Clear old sensor measurements during reload and bound client request timeouts.
- Preserve technical downloads and Deepfire simulation controls. No paid simulation was submitted during this review.

A backup of the previous running source is in /Users/yazidears/.cache/ginger-backups/satellite-20260919/src.

Verified in this task: focused Satellite TypeScript and tests pass; main-server page returns HTTP 200; the live catalog returns 20 Sentinel-2 scenes; browser-triggered vegetation analysis produced NDVI and NBR images with 98.65% valid pixels for the selected scene; empty fire history shows no playback controls. Both Deepfire history feeds responded successfully with zero local detections/perimeters. Paid spread execution, iMessage, Ash audio and Nebius activation were not revalidated.


## Follow-up interaction checks

- Coordinate errors now use the input's validation feedback in every Satellite view, rather than appearing only in Fire detections. Browser check: latitude 91 is rejected with a visible validation message.
- Switching between Satellite images, Fire detections and Measurements retains the selected scene and completed vegetation result. Verified with a real NDVI/NBR analysis and a round trip through Fire detections.
- Changing location or refreshing cancels the client-side analysis request so an obsolete result cannot replace the new selection.
- Empty Measurements no longer shows an empty table, graph or download button. It offers imagery and fire detections instead.
- Main-server /prevention and /replay return HTTP 200. Replay renders, but its historical incident library is empty. The Tasks button opens Operations log; no inspection records were created during verification.
- Satellite-focused TypeScript and the existing Satellite tests pass. Interaction checks used an isolated copy because other active tasks were updating the main server concurrently. The final Satellite component was synchronized to the source project and main server with matching contents.

No paid spread simulation, external notification or account configuration was performed in this follow-up.
