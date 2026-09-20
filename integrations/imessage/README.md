# AshConnect messaging — Mastra, Nebius, Telegram and Photon

The worker supports explicit `ASHCONNECT_TRANSPORT=imessage`, `vonage` or `telegram`. All transports use the same Mastra agent, saved subscriptions, browser pairing and monitoring evidence. Set `ASHCONNECT_ENABLED=true` after configuring one transport. `IMESSAGE_ENABLED=true` remains supported for existing Photon installations. The source directory and npm script retain their original `imessage` names for compatibility.

## Current live state — 20 September 2026

The cloud worker runs **Telegram and Photon iMessage together**, with Telegram remaining the primary web connection option. `ASHCONNECT_TRANSPORT=telegram` selects the primary and `ASHCONNECT_IMESSAGE_ENABLED=true` adds Photon. Both adapters share one Mastra agent and retain separate conversation identities; replies never fall back to another channel.

The dual-channel release activated at 10:13:30 UTC is live. Photon’s free project has a provisioned shared **Primary** sender, **+14155951440**, project credentials and an active signed HTTPS webhook. The account’s verified test phone was enrolled. At **12:19 Europe/Madrid**, a HELP sent from the physical iPhone received the actual AshConnect reply. The Secondary sender was rejected during provisioning and is not configured. Broader recipient eligibility and free-plan limits are not established by this single-phone acceptance.

Telegram `@AshConnectBot` was physically verified earlier: browser pairing, subscription confirmation, an evidence reply and browser recovery succeeded. Neither successful configuration nor a webhook HTTP 200 alone proves handset delivery.

**Natural conversation flow is deployed in the release activated at 10:24:21 UTC.** All 72 messaging tests, TypeScript and the full Next.js production build passed on the VM. Live geocoder, canary-route authentication and public/private route-isolation checks passed. Both channels are configured and monitoring evidence is fresh; public URLs are unchanged. Physical testing of the natural flow is now pending. The iMessage result above proves the earlier HELP path, not yet the new address search, later confirmation, natural management or follow-up evidence path.

## WhatsApp with the Vonage sandbox

1. Open the Vonage Messages API Sandbox. Enrol the recipient's WhatsApp number using the dashboard's instructions. The person must complete this step on their own phone.
2. Set `ASHCONNECT_TRANSPORT=vonage`, `VONAGE_API_KEY`, `VONAGE_API_SECRET`, and `VONAGE_WHATSAPP_SENDER` (sender digits from the sandbox example, without `+`). Configure Nebius as described below. Generate a separate random `VONAGE_WEBHOOK_TOKEN` of at least 32 characters.
3. Register these HTTPS URLs as the sandbox's inbound and status webhooks, substituting the private token:

```text
https://YOUR-HOST/api/agents/ginger-watch/channels/whatsapp/webhook?token=YOUR-PRIVATE-TOKEN
https://YOUR-HOST/api/agents/ginger-watch/channels/whatsapp/status?token=YOUR-PRIVATE-TOKEN
```

The query token is mandatory and must be kept secret; configure proxies to omit query strings from access logs. When the Vonage account signs webhook JWTs, also set `VONAGE_SIGNATURE_SECRET`; the worker then requires both the private URL token and a valid HS256 token matching the API key, recent issue time and raw payload hash. Do not set this optional secret unless signed callbacks are enabled for the sandbox.

4. Set `ASHCONNECT_ENABLED=true` and run `npm run imessage` with the backend. Put the same `ASHCONNECT_TRANSPORT=vonage` and public sender in the web app environment for WhatsApp connection links. The worker retains legacy deterministic commands alongside the natural conversation tools. Address registration requires a separate affirmative confirmation; receiving a search result does not subscribe anyone.

The adapter uses the sandbox endpoint exclusively, buffers model output into one text message and spaces provider calls at least 1.1 seconds apart. Replies and updates are allowed only after an authenticated inbound message, within WhatsApp's 24-hour reply window. Reply-window timestamps persist in private local storage; after expiry the person must message again. No templates are sent. Provider acceptance is not handset delivery. Status callbacks are acknowledged but are not displayed as confirmed delivery.

The sandbox requires recipient enrolment, permits 100 messages/month and one message/second, and cannot deliver ongoing free-form alerts outside the 24-hour window. Use it for a labelled demonstration; production needs a registered WhatsApp sender and a separate approved-template design. [Official sandbox contract](https://developer.vonage.com/en/messages/concepts/messages-api-sandbox), [official Basic-auth quickstart](https://developer.vonage.com/en/blog/sandbox-quickstart-send-and-receive-whatsapp-messages-with-python).

## Telegram without a public webhook

Set `ASHCONNECT_TRANSPORT=telegram` and `TELEGRAM_BOT_TOKEN`. Enable the worker with `ASHCONNECT_ENABLED=true`. Startup verifies the bot identity with `getMe`; its public username is then supplied to the web app through the authenticated bridge, so a duplicate username setting is unnecessary. `GINGER_TELEGRAM_BOT_USERNAME` is only an optional web-side fallback while the worker is unavailable. Telegram uses long polling against the Bot API, so the existing private host needs outbound HTTPS only. Browser pairing opens `https://t.me/BOT_USERNAME?start=CONNECT_PAIRINGTOKEN`; starting that conversation explicitly opts the person into the connection flow. Only private DMs are processed. The polling cursor and known conversations persist on disk. Startup rejects an existing bot webhook with a clear error; it never deletes that webhook. Do not run another polling worker or webhook consumer for the same bot.

For each newly enabled transport, verify an incoming message and reply, opt-in, an evidence response, a labelled test update, stopping updates and restart persistence with a consenting recipient. Current verified results are recorded above.

An opt-in wildfire-watch agent built with `@mastra/core` and Mastra Channels, using Photon's iMessage adapter or the adapters above. Nebius supplies tool-capable inference for questions; Mastra LibSQL memory retains conversation history. A background loop texts changes from Ginger's prepared monitoring evidence to subscribed conversations, even when no browser is open.

## Run with Photon iMessage

Requires Node 22.13+, one long-running Node process and persistent disk. Install the separate service dependencies from the Ginger project root:

```sh
npm --prefix integrations/imessage ci
cp integrations/imessage/.env.example integrations/imessage/.env
```

1. Create a Photon project and provision **one iMessage sender/line** at https://app.photon.codes. Account creation, line provisioning and any fees are handled in your own account.
2. Set `IMESSAGE_PROJECT_ID` and `IMESSAGE_PROJECT_SECRET` in the service `.env`. Set `NEBIUS_API_KEY` and `NEBIUS_MODEL` there or use Ginger's existing `.env.local`. Select a model supporting text, streaming and tool calls. The service does not guess a model or silently switch providers.
3. Expose local port 4112 through a stable public HTTPS reverse proxy, or a development tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:4112
```

4. In Photon, register this signed webhook URL:

```text
https://YOUR-HOST/api/agents/ginger-watch/channels/imessage/webhook
```

5. Save Photon's per-webhook signing secret as `IMESSAGE_WEBHOOK_SECRET`. Set `IMESSAGE_ENABLED=true` and start these in separate terminals from the Ginger root:

```sh
npm run backend
npm run imessage
```

The service binds only to `127.0.0.1:4112`. It reads the same prepared `workspace-v1` snapshot as Ginger using the project-root cache key. If the backend uses `GINGER_SNAPSHOT_DIR`, give the messaging service the same absolute path. `/health` reports process health and `dataFresh` separately. A healthy HTTP server does not prove upstream authentication or phone delivery. No public webhook is added to the Next.js server.

The worker starts only with explicit enablement, the selected model settings and each enabled transport’s required credentials. No messages are sent before someone subscribes, except replies to incoming DMs. Do not use personal Messages automation or copy phone numbers into configuration: destinations come from signed incoming Photon threads.

## Natural conversation flow

This flow is deployed; physical phone acceptance is pending. Start by messaging the bot directly; no website or command menu is required.

1. **Name a place or address.** Ash asks for a town or a clearer address when necessary. Location search currently covers Catalonia.
2. **Confirm the proposed location.** Ash shows the returned place label, explains the **1 km** watch radius and asks whether it is correct. Search alone does not register or subscribe. Confirmation must be an actual affirmative message in a later turn, within **15 minutes**, from the same authenticated conversation. The pending choice and coordinates stay server-side; model-supplied coordinates or a fabricated confirmation cannot create a watch.
3. **Ask for evidence naturally.** Questions such as “How is my place looking?” use that conversation’s watched places. Missing or stale evidence stays explicitly unknown. A newly registered location waits for its first monitoring scan.
4. **Manage updates in the conversation.** Ask which places are being watched, stop watching one place, or say stop to end all updates. Ask to stop reminders after acknowledging an escalation. Repeated reminders are off by default and require explicit opt-in; when enabled, there are at most three reminders, five minutes apart.

Legacy HELP/START, AREAS, WATCH, STATUS, ACK and STOP parsing remains compatible, including existing browser CONNECT links. Onboarding and ordinary replies no longer require people to learn those commands. Natural mutations use the authenticated thread and incoming-message identity, preserve replay protection, and cannot modify another conversation’s subscriptions. Stop-all handling is deterministic and bypasses the normal conversational rate limit.

Only direct messages are supported. Group messages, self echoes and contentless read receipts are ignored. No autonomous evacuation, emergency-service contact or arbitrary-recipient tool exists. AshConnect also retains a separate operator-only composer for opted-in conversations linked to selected locations.

## Delivery behaviour and limits

- Polls the backend's prepared snapshot once per minute; the existing monitor normally scans every ten minutes. This is not continuous fire detection.
- Only changes newer than the subscription/delivery cursor are sent. Repeated scans remain quiet unless a user explicitly enabled repeated reminders and an unacknowledged escalation reminder is due. One combined message per subscribed conversation per cycle, with a concise evidence summary for up to three affected places.
- Freshness cutoff is 20 minutes. Stale/future snapshots suppress proactive sends; evidence requests report unavailable/stale evidence. This service is not an emergency alert system and silence is not an all-clear.
- A successful provider return advances that recipient's cursor; failures retain it for the next cycle. Delivery is **at least once**, not exactly once: a crash after provider acceptance but before saving the cursor, or an ambiguous network error, can duplicate an update. Provider acceptance does not prove handset delivery.
- STOP prevents future sends; a message already in flight may still arrive. Commands and sends serialize within the worker.
- Requires one worker for all enabled transports. A lock prevents accidental parallel workers. Startup recovers a stale lock only after the operating system confirms its recorded PID no longer exists; live PIDs, malformed locks and conflicting recovery attempts fail closed. Inspect a leftover `.ginger-data/imessage/worker.lock.recovery` directory after a crash during recovery before removing it.
- Local subscription state supports up to 100 conversations, including stopped conversations retained to reject recent replayed commands. Command replay receipts retain the latest 256 mutations per conversation. Mastra also persists channel state in LibSQL.
- The location registry is shared across the workspace and capped at **20 places globally**, including regional defaults; it is not 20 private places per resident. The natural flow shares this existing demo limit.
- Conversation history, thread IDs, transport state, pending address choices and subscriptions persist under `.ginger-data/imessage/`; registered place labels and coordinates persist in the shared watch-area store. These are plaintext application files or a SQLite database, not application-encrypted records. A natural registration stores the geocoder’s returned label, cleaned and truncated to 80 characters; this can include address information. Do not claim that addresses or conversations are not stored. Stopping updates does not erase these records.
- Keep those stores private and excluded from Git/backups intended for publication. Location searches go to the configured geocoder. Conversation text and requested evidence go to the messaging and model providers used by the conversation. Optional evidence-only summaries send anonymous measurements, but this does not make the conversational agent anonymous. Nebius’s selected zero-retention account setting does not remove local storage. No operator observation/task records are loaded by the messaging agent.
- This service uses its own dependency manifest and lockfile so installing Mastra does not alter Ginger's Next.js dependency tree.

## Verification

```sh
npm run typecheck:imessage
npm run test:imessage
```

Tests use fixture identities/credentials and mocked sends. They cover opt-in timing, persistence across restart, recipient isolation, STOP, replayed subscription commands, failed sends, stale/future evidence, corrupted state, channel handler routing and rejected webhook signatures. No phone messages or model calls are required.

### Live judging checklist

1. Verify the backend and messaging health, including fresh monitoring evidence.
2. On the recipient’s phone, message the configured sender and receive an actual reply.
3. Name a public demo place in Catalonia, verify its proposed label and 1 km radius, and confirm in a later message. Check the saved subscription and ask a follow-up evidence question.
4. Demonstrate a controlled change using an isolated demo snapshot directory; label it simulated. Confirm only the intended subscribed phone receives the update. Never present fixture changes as live fire observations.
5. Restart cleanly; verify conversation and subscription persistence without replaying the same update.
6. Ask to stop watching the place or stop all updates, then introduce another demo change and confirm no proactive update arrives.
7. Submit the sender/contact instructions and allowed source, and keep the service running through the judging window. The physical iMessage HELP response is recorded above; the full natural-flow checklist remains pending acceptance.

Official contracts: [Mastra iMessage](https://mastra.ai/integrations/channels/imessage), [Mastra Channels](https://mastra.ai/docs/channels), [Photon adapter](https://github.com/photon-hq/vercel-chat-adapter-imessage).

## Legacy Home Watch setup

Open `/home-watch` from the map navigation or Watch areas. Search an address, confirm or correct its map pin, choose a radius, and save a nickname. The page uses the existing shared watch-area store, not a private account: nicknames and coordinates are visible to workspace users. The legacy Home Watch page saves the supplied nickname rather than the complete search query. The newer natural registration flow saves the cleaned geocoder label, truncated to 80 characters, so address information can persist in the same store. Geocoding queries are sent only on explicit search to the configured Photon **geocoder** (unrelated to the Photon messaging provider), with a short in-memory cache and application rate limit. Configure `GINGER_GEOCODER_URL` in the root environment for a private or production geocoder; the default is Komoot's limited public demo service.

Set `GINGER_IMESSAGE_CONTACT` in the root environment to the provisioned Ginger sender in E.164 format, such as `+15555550123`. It is public contact information, not a recipient. The page then offers an Open Messages link with a `WATCH <area ID> REPEAT` command. The person must send it themselves and receive Ginger's confirmation. Until the contact is configured, the page explicitly reports messaging connection pending. A configured number alone does not prove worker health or delivery. Saving a pin never subscribes or sends a message. New locations can subscribe before the backend publishes their first prepared snapshot; replies explicitly say that the first scan is pending.

Urgency comes from Ginger's existing monitoring rules, not an LLM probability of property destruction. `escalating` means nearby thermal detections coincide with the configured hazardous-weather window. No critical/evacuation tier is inferred. Reminders require a fresh overall snapshot and fresh zone evidence; failures retain the delivery state for retry. ACK and STOP bypass conversational rate limits. Tests cover recipient isolation, restart persistence, the cap and cadence, acknowledgement before delivery, recovery/new episodes, coverage gaps, deleted areas and failed sends.

## Browser pairing and AshConnect

`/ash-connect`, beside Ash, remains an optional address-registration flow with **Telegram as its primary web channel**. Search and select a location, confirm its pin and place type, then open the personal messaging link. Explicit geocoder amenity tags may select School or Hospital; the person can correct the type. Those browser choices request bounded repeat notifications, while Home does not. This is separate from the new natural conversation flow, whose watch radius is 1 km and whose repeats default off.

Browser registration creates a single-use CONNECT code valid for 15 minutes. A persistent HttpOnly cookie owns the browser registration, and only the authenticated DM consuming that code enables its status. Aggregate subscriber counts cannot enable another resident’s screen. Reload restores saved places, stopping updates removes enabled status, and expired codes can be renewed. Late polling responses cannot overwrite a newly saved place. The page does not yet offer a channel selector; the additional Photon sender is available by messaging it directly.

Use the same `ASHCONNECT_OPERATOR_TOKEN` (32+ random characters) in the web app and worker; it stays server-side in the resident flow. Set `GINGER_IMESSAGE_CONTACT` to the public provisioned sender for iMessage contact metadata. Public ingress allows only the resident routes and the signed Photon webhook; `/internal/ash-connect`, registry administration and operator dispatch stay private. Browser ownership does not convert the underlying shared registry into private per-user storage.

### Inference provider

Nebius remains supported by default. To use an existing OpenAI account instead, explicitly set `IMESSAGE_MODEL_PROVIDER=openai`, `IMESSAGE_MODEL=gpt-4.1-mini` and `OPENAI_API_KEY`. Provider choice is explicit; there is no automatic fallback. Configure a valid Photon sender, project credentials and webhook signing secret, then set `IMESSAGE_ENABLED=true` and run the worker. Successful startup is not evidence of a delivered iMessage.

The internal operator API preserves audience isolation, STOP, deduplication, one-dispatch-per-minute limits, persisted retry protection, and unknown outcomes after ambiguous provider failures. Only provider acceptance is recorded, not handset delivery.
