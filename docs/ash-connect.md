# AshConnect

`/ash-connect`, beside Ash, contains address search, location confirmation, place type and connection to the configured messaging channel. The operator dashboard and explanatory prose were removed at the user's request.

Explicit geocoder amenity tags select School or Hospital automatically; users can correct that selection. The type persists with the saved location. Schools and hospitals select bounded repeat notifications. New places may subscribe before their first monitoring scan; no monitoring result is invented while waiting.

Registration now creates a private, single-use `CONNECT` code valid for 15 minutes. A persistent HttpOnly browser cookie owns the registration. The worker confirms only the authenticated direct-message conversation that consumes this code; aggregate subscriber counts cannot enable another person's screen. Reload restores saved places, STOP removes enabled status, and expired links can be renewed. Late polling responses cannot overwrite a newly saved place.

The existing bounded reminders still allow at most three repeats, five minutes apart, with ACK and STOP handling. The authenticated operator dispatch API remains implemented separately, but its composer and controls are no longer part of this screen.

## Partner integration status — 20 September 2026

- **Mastra:** agent, evidence tools, memory, opt-in subscriptions and bounded reminders. Legacy commands remain compatible; the natural place-search, later confirmation and management flow is deployed, with physical phone acceptance pending. Stale individual-area readings are now rejected even inside a fresh overall snapshot.
- **Telegram:** `@AshConnectBot` is provisioned and its identity verified. The private cloud worker is the sole poller; local workers stay disabled. Token-authenticated long polling, durable cursor/known-chat storage, and native pairing links require no public webhook. An existing webhook causes a clear startup error rather than being silently deleted. A permanent recipient refusal cannot block later residents' commands; transient failures remain retryable.
- **Vonage:** WhatsApp sandbox adapter with authenticated inbound/status webhooks, persisted 24-hour reply windows, rate limiting, and single buffered replies. Sandbox recipient enrolment is separate from AshConnect pairing; the sandbox's monthly allowance and lack of approved-template support mean this is not a production notification service.
- **Photon:** live alongside Telegram in the dual-channel release activated at 10:13:30 UTC. The free project has its shared Primary sender **+14155951440**, the verified test phone enrolled, project credentials and a signed HTTPS webhook. A physical iPhone HELP message received the actual AshConnect reply at **12:19 Europe/Madrid**. The Secondary sender was rejected and is not configured. This verifies that one enrolled recipient’s incoming/reply path; it does not establish broader free-plan recipient coverage.
- **Nebius:** voucher redeemed and a private API key configured for `zai-org/GLM-5.3-Flash`, with zero data retention selected during account setup. A live request through the actual Mastra agent called `readWatchEvidence` and correctly reported the synthetic 37 km/h wind and two unconfirmed detections. Existing OpenAI model-list access returned 403 and inference returned 401 `missing_scope`; AshConnect now explicitly selects Nebius.
- **SLNG:** existing native Ash speech adapter passed a live synthetic speech-to-text/text-to-speech round trip. See [exact evidence and UI boundary](ashconnect-slng-evidence.md). The web `/ash` room uses OpenAI Realtime, not SLNG.
- **Galtea:** live submission completed: six self-hosted invariant scores plus eight hosted judgments. Safety checks passed 4/4; the two-case reply-quality score improved from 1/2 to 2/2 after the prompt fix. The judge detected the unsupported storage denial but missed the original truncated reply. See [exact results and limitations](../integrations/galtea/RESULTS.md).

Choose the primary transport with `ASHCONNECT_TRANSPORT=telegram|vonage|imessage`, configure its credentials and the model, then explicitly enable `ASHCONNECT_ENABLED=true`. The current cloud configuration keeps Telegram primary and adds Photon with `ASHCONNECT_IMESSAGE_ENABLED=true`. Both adapters share one worker and retain separate conversation identities. The browser UI still offers Telegram as primary; it has no channel selector yet. Shared operator keys stay server-side. No real messages were sent during fixture validation.

The cloud release installer now includes a persistent messaging service sharing Ginger's registry, snapshots and subscription state, plus an optional allowlisted webhook proxy. Telegram does not require that proxy. The main web application remains private; the temporary resident-only tunnel below provides phone access. Do not expose the worker's internal operator API. See [cloud deployment](deployment/GOOGLE-CLOUD.md).

Monitoring publication no longer waits for slow local GIS preparation. Background GIS results retain their original dates and cannot overwrite a newer monitoring snapshot. Provider coverage and freshness remain separate from process health.

## Validation

- The natural-conversation release activated at 10:24:21 UTC is active. **All 72 messaging tests**, TypeScript and the full Next.js production build passed on the VM. Live geocoder, canary-route authentication and public/private route-isolation checks passed. Both channels are configured, monitoring evidence is fresh and public URLs are unchanged. Physical natural-flow acceptance is pending. Earlier releases separately passed their recorded checks below.
- Resident-route tests cover browser isolation, session recovery, real command consumption, STOP, origin checks, and worker-offline behavior.
- CUA rendered an isolated fixture flow: public hospital search, automatic hospital selection, Telegram link, command-confirmed repeat subscription, reload recovery, STOP and a deliberately delayed polling response. No provider message was sent.
- The minimal cloud candidate passed full web TypeScript and production build, backend/receptivity/monitoring checks and webhook proxy isolation tests.
- Private release `20260920T093000Z-ashconnect` is deployed and `/ash-connect` has been rendered through IAP at `http://localhost:3004/ash-connect`. After fixing stranded provider requests, real scans advanced from `2026-09-20T09:22:11.430Z` to `09:29:12.603Z` when the public hospital demo location was registered, then to `09:32:07.655Z` on the natural timer without a backend restart. All seven areas had current monitoring coverage. Publication continued independently, and original source retrieval timestamps were retained.
- Cloud web, monitoring, forest and messaging services are active and bind to loopback. Initial cloud verification covered 214 source hashes, the production build, 42 worker tests and 19 provider deadline/error checks. The later dual-channel deployment enabled only the signed Photon webhook through the public proxy; the worker’s internal API remains private. Physical Telegram pairing and evidence receipt were subsequently verified as recorded below. Handset unsubscribe and change-triggered push acceptance remain separate.
- Six actual-code adversarial cases and four Galtea adapter tests passed. The actual Nebius agent and completed Galtea hosted judgments are verified separately; this does not certify overall product safety or physical delivery.

Read-only readiness inspection (prints configuration presence and timestamps, never key values):

```sh
npm run check:ashconnect
node scripts/check-ashconnect.mjs --root /absolute/runtime --model-check
```

`--model-check` only reads the provider model list. It does not generate text, deliver messages, or prove handset delivery. A running worker does not establish monitoring freshness or a valid upstream account.

Preview and candidate checks use materialized copies because the original iCloud-backed checkout has dataless dependency/source stalls. They do not establish a full original-checkout build. The legacy `/api/watch-areas` interface still uses the shared, bounded demo registry; only the AshConnect resident endpoints implement browser ownership. The legacy registry and operator interfaces remain private.

## Temporary public phone access — 20 September 2026

At the user's request, the VM now serves [AshConnect over HTTPS](https://generations-cingular-unlock-thesis.trycloudflare.com/ash-connect) through a Cloudflare Quick Tunnel. This runs independently of the Mac and IAP forwarding. The hostname changes if the tunnel restarts; the existing VM shutdown remains 23:59 Europe/Madrid.

`ginger-ashconnect-public.service` runs `scripts/cloud/ashconnect-public-proxy.cjs` on loopback port 4114, installed under `/opt/ginger/shared/tools`. `ginger-ashconnect-tunnel.service` connects that proxy to Cloudflare using the official, SHA256-verified cloudflared 2026.9.1 binary. No inbound firewall opening or DNS change was needed.

The proxy allows the resident page, its static assets, public channel status, owned resident registration, address search and the exact signed Photon iMessage webhook path. Photon validates the raw-body signature inside the worker; a successful webhook HTTP response alone does not prove a delivered reply. It rejects unrelated routes and operator dispatch, strips caller-supplied operator credentials, validates the public HTTPS origin before rebasing upstream requests, and makes resident cookies Secure. Its HTTP tests cover these boundaries and request size limits.

External checks verified page/status/resident reads and private-route rejection. The rendered HTTPS flow completed a public hospital search, map selection, personal Telegram link creation and reload recovery, with the pairing screen checked at 390 × 844.

At 11:44 Europe/Madrid, iPhone Mirroring verified the physical iPhone Safari flow using Hospital de Sant Pau as a public demo location. Opening the personal Telegram link and tapping Start produced the actual subscription confirmation in AshConnect's bot conversation. A STATUS request received a live evidence reply. Safari then restored “Enhanced notifications enabled” and “Your conversation is connected” after refresh. The phone was left on this connected screen for the demo. STOP and actual change-triggered push delivery remain untested on the handset; the hospital subscription remains enabled.

## Resident summaries

STATUS now defaults to the requesting conversation's saved places instead of dumping the first six regional records. Natural-language evidence requests also resolve the authenticated Mastra channel thread before selecting the default places. A place with no scan stays pending; a fresh global snapshot cannot make stale local evidence current.

Optional Nebius summaries receive only anonymous measurement records, never resident addresses or channel identifiers. A stateless, bounded model call adds a short explanation above deterministic measurements, scan time and the fixed uncertainty caveat. Rejected, empty, truncated, unavailable or timed-out output falls back to those observations. The summary cache is bounded and lives for one minute. STATUS inference runs outside the subscription lock, so it cannot delay STOP, ACK or resident polling. Pairing acknowledgements and proactive change notifications use the compact deterministic format without waiting for AI.

Two synthetic live Nebius requests passed the output validator: a zero-detection status and missing evidence. The accepted status explanation was “Monitoring continues with no unconfirmed thermal detections recorded. Wind observations are available.” The initial 250-token budget exhausted GLM's reasoning allowance before producing text; the final inference budget is 1,000 tokens, with a separate 70-word maximum for visible output, a 30-word prompt target and a 10-second deadline. This conservative lexical filter is not a semantic safety certification; fixed facts and caveats remain visible.

All 54 messaging tests and TypeScript passed on the cloud VM for the final six-file summary change, including authenticated conversation scoping, missing-context rejection, timeout fallback, and STOP while STATUS inference is pending. Release `20260920T100500Z-ashconnect-summary` was activated with only the messaging process restarted; web, monitoring and the public tunnel remained running. Health, fresh monitoring, Telegram configuration, Nebius model access and the existing public URL passed after activation. The new summary reply has not yet been checked on the handset because iPhone Mirroring was paused by physical phone use.

That summary release initially ran Telegram alone. The later dual-channel release activated at 10:13:30 UTC provisioned and enabled Photon as recorded above, and the physical iPhone received its HELP reply at 12:19 Europe/Madrid. Galtea’s earlier hosted receipts evaluate earlier agent replies; they are not a hosted evaluation of the summary path or the newer natural registration tools.

## Natural conversation registration — deployed, phone acceptance pending

Message the bot a place or address in Catalonia. Ash shows the proposed geocoder label, explains that it will watch within **1 km**, and asks whether the place is correct. Searching does not create a location or subscription. Registration requires a real affirmative reply in a **later message**, within **15 minutes**, in the same authenticated DM. The pending choice, coordinates and thread binding are stored server-side; the model cannot invent coordinates, reuse another conversation’s pending choice or supply its own confirmation text.

After confirmation, evidence changes are enabled with **repeated reminders off by default**. People can ask what is being watched, ask about their place, stop watching one location, stop reminders, or stop all updates naturally. Mutations retain per-conversation replay receipts and isolation; stop-all handling is deterministic. Existing browser pairing and legacy command parsing remain compatible. Web School/Hospital repeat selections are a separate flow and do not change the natural-flow default.

The natural-flow release activated at 10:24:21 UTC is active, with **72 messaging tests**, TypeScript and the full Next.js production build passing on the VM, plus live geocoder, canary-route authentication and public/private route-isolation checks. The current physical iMessage evidence remains the earlier HELP reply at 12:19; an address proposal, actual affirmative confirmation, scoped evidence reply and natural stop still need phone acceptance. Physical testing has begun with iPhone Mirroring connected; no natural-flow handset result is claimed yet.

## Storage and privacy boundary

The location registry remains a shared demo store capped at **20 locations globally**, including regional defaults. Browser ownership and thread-bound tools isolate connections and mutations; they do not make this registry a private account system.

A natural registration stores the cleaned returned geocoder label, **truncated to 80 characters**, together with coordinates and a 1 km radius. The label may contain address information. Pending choices, transport identifiers, subscriptions and conversation history also persist. Application JSON files and Mastra’s SQLite history are stored in plaintext at the application layer, protected by host access and file permissions; they are not application-encrypted. Stopping updates is an opt-out, not a deletion request, and does not erase history or saved addresses.

Address searches are sent to the configured geocoder, and conversational messages pass through the messaging and model providers. The optional stateless summary call receives anonymous measurements, but the broader conversation can include the user’s address. Nebius’s selected zero-retention account setting does not erase Ginger’s local records. Do not tell residents that their address or chat history is not stored.
