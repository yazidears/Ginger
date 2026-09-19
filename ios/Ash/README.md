# Ash — Ginger field voice companion

Native SwiftUI iPhone application (iOS 18+). Open `Ash.xcodeproj`, select a signing team for a physical device, and run the Ash scheme. Regenerate with `xcodegen generate` after adding files.

## Continuous voice

The default screen is Ask Ash. Start a voice session once after configuring the connection. The microphone stays active through the session, including with the screen locked via the audio background mode. Say **“Ash, what is the wind doing?”**; voice activity detection closes the turn after one second of silence and submits it automatically. Say **“Ash, stop listening”**, or tap End voice session, to stop.

The Siri/App Intents shortcut is removed. There is no requirement for Siri or AirPods stem gestures.

The implementation uses bounded mono PCM WAV utterances, SLNG Nova 3 English transcription, Ginger's grounded answer endpoint, and SLNG Aura 2 English synthesis. It is utterance-based HTTP, not a full-duplex streaming agent. The audio engine remains active while a request/reply is in progress, but speech segmentation is gated during that interval to prevent playback feedback and unbounded queues. Barge-in is not implemented. Utterances are capped at 15 seconds; silence is not uploaded. Speech segments—including speech not addressed to Ash—are sent to SLNG; only an initial “Ash” or “Hey Ash” triggers a Ginger answer.

Phone calls, audio-service resets or lost/changed headsets pause the session with an explicit error. Three consecutive turn failures stop it. These controls do not establish field reliability: real wind, sirens, accents, lock-screen behavior, battery use, and long-duration sessions need physical acceptance.

## Configure SLNG

Set these **server-side** environment variables, then restart Ginger:

```dotenv
SLNG_API_KEY=<your SLNG API key>
ASH_ACCESS_TOKEN=<a separate random token of at least 32 characters>
SLNG_BASE_URL=https://us-east.api.slng.ai
SLNG_VOICE=aura-2-thalia-en
```

The selected SLNG-hosted English models are documented for US East and US West; this integration allows those two gateways. It does not claim EU processing. Change the provider adapter before selecting models/regions with different contracts.

In Ash → Field → Connection, enter your Ginger HTTPS URL and the separate **Ash access token**, then Save connection. The app stores the Ash token per server in iOS Keychain. The SLNG vendor key never goes to the phone. “Check server configuration” verifies the app-to-Ginger configuration only; a successful real speech turn is required to verify vendor credentials.

For local simulator use, run Ginger with `npm run dev -- --port 3003` and use `http://localhost:3003`. On hardware use a reachable HTTPS server or a `.local` development hostname. Exercise mode can demonstrate bundled answers but still needs SLNG configuration for voice; disable it for actual Ginger context.

### Endpoints

- `GET /api/ash/voice/status`: authenticated configuration readiness (not vendor credential verification).
- `POST /api/ash/voice/transcribe`: authenticated `audio/wav`, mono PCM16, bounded to 16 seconds and 1,536,044 bytes.
- `POST /api/ash/voice/speak`: authenticated JSON `{ "text": "..." }`, max 4,000 characters; returns WAV.
- `POST /api/ash`: existing typed question plus coordinates; adding `fix` requires the Ash token and returns position-linked Ginger situation data.

Voice requests have provider timeouts, bounded bodies/responses, fixed provider destinations, a process-local limit of 120 requests/minute and eight concurrent requests. This is a shared prototype access token, not per-unit identity or production organization authorization. Use trusted deployment boundaries; durable multi-instance quotas and identity management remain separate work.

## One AirPod and unit sharing

The app captures mono audio, prefers the connected Bluetooth HFP microphone, and plays mono SLNG replies over the selected output. In iPhone AirPods settings, set Microphone to **Automatically Switch AirPods**; Apple documents that the earbud in use supplies the microphone when only one is worn.

One pair is a shared connection. Splitting its earbuds between two people does not create independently addressable unit radios or separately selectable left/right microphone streams. Each independent unit needs its own supported phone/headset connection. Ash displays the actual audio route but cannot detect or certify that exactly one earbud is worn. No “works perfectly” hardware claim is made.

Crew remains an explicitly separate foreground nearby voice-message channel. Entering Crew ends the Ash voice session so two audio owners cannot compete. Audio messages use encrypted MultipeerConnectivity with explicit invitations and send actions; no background dispatch transport or wide-area unit radio is connected.

## GPS, DGPS and Ginger situation

Enable **Use my GPS position** outside Exercise mode. Core Location requests permission and supplies coordinates, fix time and estimated horizontal accuracy. Requests require a fix no older than 60 seconds and accuracy no worse than 1,000 m; stale/missing fixes never silently become the selected sector.

The authenticated `fix` payload is:

```json
{"question":"What observations are nearby?","lat":41.3,"lon":1.86,"fix":{"lat":41.3,"lon":1.86,"accuracyM":8,"observedAt":"2026-09-19T12:00:00Z","source":"ios-core-location"}}
```

Use an actual current timestamp. Ginger returns weather/satellite evidence for that position, recent unverified operator observations within 10 km, and open nearby inspection tasks. Observation age is limited to 24 hours; distances are straight-line, not routes. Device fixes are client-reported, not cryptographically attested.

**DGPS is unavailable:** no correction feed, NTRIP/RTCM service or validated receiver is present in this workspace. Phone GPS accuracy is never relabelled as differential GPS. Connecting an actual DGPS receiver requires its protocol/feed and fix-quality metadata. AirPods do not supply independent unit coordinates.

## Validation

```sh
node scripts/test-ash.cjs
node scripts/test-ash-voice.cjs
cd ios/Ash
xcodegen generate
xcodebuild -project Ash.xcodeproj -scheme Ash -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Current checks: simulator app build and all six native XCTest cases reported passed (the xcodebuild runner stalled after completion and was stopped at its 150-second limit); grounding/HTTP-handler tests and mocked SLNG authentication, WAV contracts, errors, bounds and GPS filtering passed. The actual Swift audio segmenter passed standalone silence, end-of-turn, backpressure, nonfinite input and sustained-noise bounds checks. No vendor credentials were available for a live SLNG call. Whole-workspace type checking is blocked by unavailable/cloud-evicted files and missing generated SAGE types; the complete Ash route/library dependency graph type-checks with zero errors. Physical AirPod, background recording, GPS and two-unit acceptance remain open.

## Protocol references

- [SLNG Nova 3 English HTTP](https://docs.slng.ai/api-reference/speech-to-text/slng/deepgram-nova-3/nova-3-english-http)
- [SLNG Aura 2 English HTTP](https://docs.slng.ai/api-reference/text-to-speech/slng/deepgram-aura-2/aura-2-english-http)
- [Apple AirPods microphone settings](https://support.apple.com/guide/airpods/change-settings-for-airpods-or-airpods-pro-dev57e5b7e58/web)
- [Apple background recording](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record)

## Device setup update — 19 September 2026

The voice client now rejects a missing Ash access token immediately, bounds configuration requests to a 10-second request / 12-second resource timeout, validates the configuration response, and cancels a pending connection when the session ends. Microphone permission has its own status message.

Debug device setup can supply `ASH_SETUP_SERVER` and `ASH_SETUP_TOKEN` through the launch environment. The app validates the URL, persists it in UserDefaults, and stores the token in Keychain. No SLNG key is sent to the phone. This setup path is excluded from Release builds.

The signed update was installed and launched on the iPhone 15 Pro. SLNG credentials are now configured in both the workspace and the active server copy at ~/.cache/ginger-server. A live authenticated round trip passed: status 200, SLNG speech synthesis 200 (24 kHz mono PCM16), transcription 200 with the expected words. Physical microphone, single-AirPod routing and lock-screen behavior still require acceptance. A separate Unmute package is available at `voice/ash-unmute`; it validates and compiles but is not the iOS runtime and has not been deployed.
