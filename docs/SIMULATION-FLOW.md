# Selected-location simulation

The Inspect view's **Simulate** button opens `SageSimulation` with `autoStart` and submits the selected coordinates using the existing `/api/sage/runs` contract. Initial values remain explicitly hypothetical scenario assumptions. Opening a saved `sageRun` URL resumes that run instead of creating a new job.

While a job is starting, queued or running, the map expands and shows a decorative scanning treatment over the real terrain/building inventory. Text uses the backend's actual stage; the moving line is indeterminate, not a percentage or a claim that data is complete. Failed runs return to the editable controls and expose the backend error. Status polling retries temporary transport failures without submitting another job.

A completed result reveals the timeline and plays from minute zero at one simulated minute per 160 ms. Pause, Replay and manual scrubbing are available; playback stops at the forecast horizon. With reduced motion enabled, the preparation treatment is static and completed results open at the final minute without autoplay. The user can still choose Play explicitly.

The UI does not implement or calibrate the numerical model. It consumes its existing completed result and engine/source metadata, including GingerO1 updates from the model-development task.
