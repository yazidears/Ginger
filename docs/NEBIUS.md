# Nebius Token Factory for Ginger

Nebius is an optional provider for Sage's evidence-grounded explanations. It does not replace the GingerO2 fire-spread engine, retrain its coefficients, or improve its measured accuracy by being connected.

## Server setup

Create a Token Factory API key in your own account and choose an available **text chat model** from its model catalogue. Put the following in the project-root `.env.local` (or the deployment's server secret store), then restart the server:

```dotenv
SAGE_PROVIDER=nebius
NEBIUS_API_KEY=your-private-key
NEBIUS_MODEL=exact-model-id-from-your-account
```

Do not prefix these variables with `NEXT_PUBLIC_`, paste keys into chat, or commit the file. The adapter sends keys only from the server to the fixed Nebius endpoint. It never returns them to the browser. No model is guessed: both the key and model ID are required. An unknown provider is treated as unconfigured, not silently redirected.

For the original provider, omit `SAGE_PROVIDER` (or set `openai`) and configure `OPENAI_API_KEY`; `SAGE_MODEL` retains its existing default. There is no automatic cross-provider fallback.

When you ask Sage a question, the chosen provider receives the question, bounded conversation history and the server evidence assembled by that feature. The location-assessment feature also includes up to 20 nearby operator observations and tasks of each kind within 10 km; these are explicitly labelled unverified. Do not include sensitive information in these records unless you intend to send it to the selected provider.

## Behaviour and safeguards

Both providers receive the same evidence-grounding instructions. Requests have a 45-second timeout and a 5,000-output-token cap. Nebius uses non-streaming chat completions; only a single assistant answer with `finish_reason: stop` is accepted. Truncation, tool calls, explicit refusals, empty/oversized answers and inline reasoning tags are rejected. Separate reasoning fields are not displayed. Provider error bodies are never surfaced. These checks cannot establish the factual correctness of a model answer; its claims still need to match the provided evidence.

This feature uses inference, not fine-tuning. Promo credit value, expiry, model availability and billing must be confirmed in your account. No credits are purchased, no training job is launched, and no external request is needed by the tests.

## Verification

```sh
NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-sage-provider.ts
```

Tests mock fetch and use fixture credentials, checking provider selection, payload parity, refusal/truncation handling and safe errors. A successful mocked test is not proof of live authentication or credit redemption.

Official API contract verified against the [Nebius quickstart](https://docs.tokenfactory.nebius.com/quickstart): `POST https://api.tokenfactory.nebius.com/v1/chat/completions`, Bearer authentication, model ID and system/user messages. Further examples are in the [cookbook](https://docs.tokenfactory.nebius.com/cookbook/overview).

## Simulation explanations

The Fire Lab includes **Ask about this simulation** for completed saved runs. `/api/sage/explain` loads the result server-side and sends an allowlisted summary plus the question. Coordinates, geometry, building names, confirmation text and imported observation references are excluded from that summary. Questions are user-supplied text and are sent as written. Explanations do not execute or mutate scenarios. The provider is shown before submission.
