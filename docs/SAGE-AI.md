# Sage evidence analysis

Sage now has an on-demand AI analysis path in the live location workspace. It uses the OpenAI Responses API, with fresh server-side assessment evidence and the last six conversational exchanges. It can synthesize the weather outlook, explain changes, discuss qualitative scenarios, and identify missing evidence. This is separate from the existing uncalibrated triage rules and experimental surface-fire solver.

## Enable locally

Set `OPENAI_API_KEY` in `.env.local` (never a `NEXT_PUBLIC_` variable) and restart the server. `SAGE_MODEL` optionally selects a Responses-compatible text model; the default is `gpt-6-astra`. Open Sage, select a location, and use Ask Sage. Calls happen only after an operator asks a question. The model receives the question, recent conversation, weather/satellite evidence, source provenance and a bounded public geographic inventory. Requests set `store: false`; this does not replace the API provider's data-retention policies.

Without credentials, the panel explicitly shows that AI is not connected. It does not manufacture a template answer. `GET /api/sage` reports configuration presence only, not verified provider authentication. `POST /api/sage` refreshes the assessment and returns the answer, model, evidence timestamp, location and sources. Provider failures return an error without provider response bodies or secrets.

## Context and interpretation

The evidence packet retains source status, retrieval times, forecast valid times, units, missing inputs, and source IDs. Arithmetic summaries identify maximum wind, minimum humidity, qualifying contiguous review windows and hourly wind-direction changes of at least 45 degrees when both hours have at least 10 km/h wind. These thresholds are descriptive screening choices, not a calibrated hazard metric. Missing inventory stays null. Asset names are bounded; asset truncation is disclosed.

Changing location, refreshing the assessment or leaving Sage clears the conversation and cancels the client request. Prior assistant statements are not treated as verified evidence. Answers show the actual evidence timestamp and expandable source descriptions. Source tags are requested in the model prompt; they are not an independently verified claim-citation system.

The model has no simulation or browsing tools in this first implementation. It cannot provide computed fire arrival times or establish road safety. The existing physics engine is not executed by this endpoint. Building exposure, quantitative counterfactuals and autonomous scenario investigation require a separately tested tool/worker integration.

## Limits and verification

Input validation limits questions to 2,000 characters, history to six complete exchanges and bodies to 64 KB. The prototype permits two simultaneous analyses and six starts per minute per server process. Same-origin browser requests are required when an Origin header is present. This is a single-operator prototype, not authenticated multi-tenant access control; public deployment with a paid key requires authentication and shared quota enforcement.

`npm test` includes Sage arithmetic, validation, missing-data and mocked Responses transport checks. Mock tests validate the request/response contract, not model quality. With an actual configured key, test factual consistency, source attribution, changed-location isolation, stale/missing feeds, qualitative what-if answers, and refusal to invent arrival/evacuation values. No measured intelligence multiplier or fire-prediction accuracy improvement is claimed.

API implementation reference: https://developers.openai.com/api/docs/guides/text
