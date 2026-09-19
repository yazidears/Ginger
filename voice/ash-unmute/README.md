# Ash Unmute package

Validated and compiled with Unmute 0.5.5. This package generates a Pipecat voice agent using SLNG speech and a Ginger read-only webhook. It is not yet deployed, and the iOS app still uses its existing SLNG HTTP speech pipeline.

```sh
unmute validate voice/ash-unmute
unmute compile voice/ash-unmute
```

Supply OPENAI_API_KEY, SLNG_API_KEY, GINGER_API_URL and ASH_ACCESS_TOKEN to the generated runtime using its generated `.env.example`. Keep credentials outside this package. Supply `latitude` and `longitude` as call-start variables; no location is guessed or defaulted. These coordinates are context, not a fresh device fix or DGPS.

The generated Pipecat runtime and run instructions are in `build/pipecat/`; build output is ignored. Validation proves the configuration schema, not model availability, network access or spoken behavior. Live startup requires the provider keys and a reachable Ginger server.

The Pipecat target permits a webhook directly to Ginger. A hosted SLNG target instead requires creating a hosted tool in the destination organization and referencing it by name. Do not deploy a tool-free agent that invents Ginger situation data.

References: https://unmute.ai/build/tools/webhook and https://unmute.ai/deploy/slng
