# AshConnect: SLNG verification evidence

Verified on 20 September 2026, during the HackBarna integration pass. This records current local source and live provider checks, not deployed or physical-device acceptance.

## Existing integration

`src/lib/ash-voice.ts` already implements SLNG speech-to-text and text-to-speech. Server credentials are read from `SLNG_API_KEY`; clients use a separate `ASH_ACCESS_TOKEN` of at least 32 characters. Both variables were present in the workspace `.env.local`; neither value was printed or copied into this document.

The configured/default gateway used by the check was `https://us-east.api.slng.ai`. Models were `slng/deepgram/nova:3-en` for transcription and `slng/deepgram/aura:2-en` for synthesis, using the default `aura-2-thalia-en` voice. The official [SLNG hackathon guide](https://docs.slng.ai/hackathon) documents these model identifiers and request/response contracts.

Existing server routes:

- `GET /api/ash/voice/status`: authenticates the client and checks server configuration. It deliberately returns `credentialVerified: false`; this route makes no vendor request.
- `POST /api/ash/voice/transcribe`: accepts bounded mono PCM16 WAV and returns the transcript.
- `POST /api/ash/voice/speak`: accepts bounded text and returns WAV audio.

## Checks performed

`node scripts/test-ash-voice.cjs` passed: SLNG request contracts, authentication, payload bounds, provider errors, GPS freshness, and nearby filtering.

A short synthetic phrase was sent directly through the current source adapter using the local server environment:

> This is an Ash test briefing. No emergency is being reported.

The final successful live synthesis response contained 207,404 bytes of mono, 24,000 Hz audio. SLNG transcription returned:

> This is an ASH test briefing. No emergency is being reported.

The provider's WAV response used streaming length headers: RIFF declared length `2147418148`, and data declared length `2147418112`. Passing this unmodified response into the strict incoming-recording validator produced `Invalid WAV length or sample rate.` For the successful round-trip check, only the synthetic in-memory fixture's two length fields were set to its actual finite sizes before transcription. The native recorder already produces ordinary finite-size WAV recordings; the production adapter was not changed. Two short synthesis requests and one successful transcription request were made during investigation. No audio was delivered to another person and no phone call was placed.

This demonstrates that the local SLNG key and the current synthesis/transcription adapter work against the live provider. It does not verify the deployed server's environment, HTTP route authentication end-to-end, the complete evidence-answer pipeline, physical microphone/AirPod routing, background recording, or the user's phone.

## UI integration boundary

The existing SLNG interface is in the native iOS Ash app: **Ask Ash** → **Start voice session**, or type a question with **Read typed answers through SLNG** enabled. Connection settings store the Ginger server URL and separate Ash token; the vendor key stays on the server. The native session uses utterance-based HTTP transcription and synthesis.

The web route `/ash` is a different implementation: `src/app/ash/page.tsx` renders `AshRoomWorkspace`, which uses OpenAI Realtime through `AshRoomAudio`. It does not call the SLNG voice routes. Entering a room requires an operator token and either a completed Sage run to create a room or an existing room ID. Its **Start voice** button is disabled when `room.voiceConfigured` is false. That flag currently checks only whether `OPENAI_API_KEY` exists, not whether live model access succeeds. Microphone access also requires a supported browser and secure context.

Therefore, linking AshConnect to `/ash` does not expose the verified SLNG voice path. Such a link can accurately be labelled as opening the operator room, but cannot be presented as a working SLNG integration or a verified voice session. A browser SLNG interaction would require an explicit UI connection to the existing protected endpoints, including audio recording/encoding and the appropriate authentication flow; no such web UI was added in this pass.

## Scope

No existing source or configuration files were edited for this SLNG investigation. This document is the only added file. Entire is not set up for this repository, so the UI relationship above is inferred from current source rather than checkpoint history.
