# Ash browser voice acceptance — 20 September 2026

## What was actually exercised

Two independent browser tabs of the production build at `127.0.0.1:3051` joined an authenticated exercise room using short-lived, room-scoped memberships. The selected run was `abf18558-b5a8-45c5-ad02-5cca49c65148`, at +30 minutes, with an explicitly hypothetical basis.

The unmodified production `AshRoomAudio` class performed its normal ephemeral-secret request, SDP exchange with OpenAI, data-channel tool calls, WebRTC audio input/output, room signaling and mixed peer-audio fanout. A temporary browser-only test shim replaced `getUserMedia` with an `AudioContext` destination fed by a generated spoken question. It kept continuous zero-valued samples between utterances so the provider could detect the end of speech. This is a fixture detail, not a production audio workaround.

The generated clip asked which forecast was selected, which model minute applied, and whether it was hypothetical. OpenAI's semantic VAD detected start/end, the agent invoked incident_status through the authenticated server, and its spoken answer named the correct run and +30-minute hypothetical basis. Both room views displayed the same grounded tool event.

A second real browser peer received the mix. An analyser attached to its received media stream measured non-zero decoded speech from both the fixture caller and the subsequent Ash response. Over 30 seconds, 255 of 300 samples exceeded RMS 0.001; caller peak was 0.2673 and post-15-second answer peak was 0.1720. HTMLAudioElement playback was active; its volume was deliberately zero so the user could sleep. RTP packet counts alone were not treated as proof of audible content.

Mute set the provider sender track's enabled flag to false. Explicit Interrupt produced output_audio_buffer.cleared. End audio closed both provider and peer connections, ended the input track and released audio elements. The listener noticed the floor ending and disconnected. Starting voice again and joining its new floor reconnected both transports successfully.

A minor UI issue was found: a prior floor-change error remained visible after reconnecting or leaving. The Listen and Leave handlers now clear that stale message.

All exercise members left afterward; both old membership tokens returned HTTP 401. No operational proposal was approved. Both test tabs were closed, removing the injected file input, media constructors, synthetic microphone and audio instrumentation. No physical microphone or physical speaker acceptance is claimed.

Machine memory pressure reported 36–38% available during this work. No extra model worker, forest computation or parallel production build ran during browser voice testing.

Machine-readable evidence: `../artifacts/product-verification/ash-browser-webrtc.json`.

## Remaining physical acceptance

1. Open `/ash?sageRun=abf18558-b5a8-45c5-ad02-5cca49c65148&minute=30` in a normal browser without test instrumentation.
2. Join with operator credentials, click Start voice and allow the microphone for this origin.
3. Say “Which forecast are we using?” Verify a grounded answer for this run at +30 minutes and hear it through the intended speaker/headset.
4. Speak while Ash is talking to check natural barge-in; then test Mute, Unmute, Interrupt and End audio.
5. A second device joins the room and chooses Listen to room. Verify it hears both the speaker and Ash, with one response and shared run-linked updates.
6. Repeat across the intended demo networks. Same-machine success does not establish TURN reachability; configure the existing `ASH_ICE_SERVERS` option if a relay is required.

The user deferred this physical check. It remains an explicit open acceptance gate, not a reason to claim the whole goal complete.

## Deferred tool cancellation regression

A deterministic lifecycle test reproduced a slow tool result restarting speech after Interrupt. The continuation now retains its original session and response epoch: cancellation or new speech suppresses automatic response creation, and a stopped/reconnected session cannot receive the old output. Original-session function calls still receive their result. Normal completion, Interrupt, speech-start cancellation, and reconnect cases pass alongside TypeScript checking. This is unit-level race coverage; natural human barge-in remains pending.
