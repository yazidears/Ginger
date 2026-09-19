# Ginger on iMessage — Mastra challenge

An opt-in wildfire-watch agent built with `@mastra/core` and Mastra Channels, using Photon's iMessage adapter. Nebius supplies tool-capable inference for questions; Mastra LibSQL memory retains conversation history. A background loop texts changes from Ginger's prepared monitoring evidence to subscribed conversations, even when no browser is open.

## Current acceptance boundary

Implemented locally: channel agent, signed webhook handling, saved subscriptions, read-only evidence tool, persistent conversation storage, one-minute delivery loop and automated fixture tests. This is not proof of a provisioned iMessage number, authenticated Photon/Nebius operation, deployment or delivery to a physical iPhone. Complete the live checklist below before claiming the Mastra challenge is demonstrated.

## Run

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

The worker starts only with explicit enablement and all five required credentials/settings. No messages are sent before someone subscribes, except replies to incoming DMs. Do not use personal Messages automation or copy phone numbers into configuration: destinations come from signed incoming Photon threads.

## User experience

- `HELP` / `START`: concise onboarding.
- `AREAS`: available saved watch areas.
- `WATCH Garraf`: persist a subscription for this DM; receive the current evidence and future changes. Repeat for another area. Repeating WATCH does not replay old changes.
- `STATUS Garraf` / `STATUS`: deterministic evidence with scan timestamps and missing-data labels (up to six areas per STATUS).
- `STOP` / `UNSUBSCRIBE` / `CANCEL`: remove all proactive subscriptions for this DM. This command works even when the normal message rate limit is exhausted.
- Other text: Mastra answers using the read-only evidence tool and its conversation memory. A conversational request to subscribe is directed to the explicit WATCH command.

Only direct messages are supported. Group messages, self echoes and contentless read receipts are ignored. No autonomous evacuation, emergency-service contact, broadcast or arbitrary-recipient tool exists.

## Delivery behaviour and limits

- Polls the backend's prepared snapshot once per minute; the existing monitor normally scans every ten minutes. This is not continuous fire detection.
- Only changes newer than the subscription/delivery cursor are sent. Repeated scans remain quiet. One combined message per subscribed conversation per cycle, with up to eight changes.
- Freshness cutoff is 20 minutes. Stale/future snapshots suppress proactive sends; STATUS reports unavailable/stale evidence. This service is not an emergency alert system and silence is not an all-clear.
- A successful provider return advances that recipient's cursor; failures retain it for the next cycle. Delivery is **at least once**, not exactly once: a crash after provider acceptance but before saving the cursor, or an ambiguous network error, can duplicate an update. Provider acceptance does not prove handset delivery.
- STOP prevents future sends; a message already in flight may still arrive. Commands and sends serialize within the worker.
- Requires one worker and one Photon line. A lock prevents accidental parallel workers. After a crash, confirm the recorded PID is no longer running before deleting `.ginger-data/imessage/worker.lock`.
- Local subscription state supports up to 100 conversations, including stopped conversations retained to reject recent replayed commands. Command replay receipts retain the latest 256 mutations per conversation. Mastra also persists channel state in LibSQL.
- Conversation history, thread IDs and subscriptions live under `.ginger-data/imessage/` on disk. Keep this private and excluded from Git/backups intended for publication. Stopping updates does not erase chat history. Message text and requested watch evidence go to Photon and Nebius; no operator observation/task records are loaded by this service.
- This service uses its own dependency manifest and lockfile so installing Mastra does not alter Ginger's Next.js dependency tree.

## Verification

```sh
npm run typecheck:imessage
npm run test:imessage
```

Tests use fixture identities/credentials and mocked sends. They cover opt-in timing, persistence across restart, recipient isolation, STOP, replayed subscription commands, failed sends, stale/future evidence, corrupted state, channel handler routing and rejected webhook signatures. No phone messages or model calls are required.

### Live judging checklist

1. Start Ginger's backend and verify `/health` has `dataFresh: true`.
2. From a separate iPhone, text HELP and AREAS to the provisioned sender with no walkthrough.
3. Text WATCH for one area; check that its status and timestamp arrive. Ask a follow-up and verify a real Nebius response using current evidence.
4. Demonstrate a controlled change using an isolated demo snapshot directory; label it simulated. Confirm exactly the intended subscribed phone receives the update. Never present fixture changes as live fire observations.
5. Restart the worker cleanly; verify subscription and conversation persistence without replaying the same update.
6. Send STOP, then introduce another demo change and confirm no proactive update arrives.
7. Publish the allowed event-built source and README, submit the sender/contact instructions and repository URL, and keep the service running through the judge's window. A local implementation alone does not fulfill that submission requirement.

Official contracts: [Mastra iMessage](https://mastra.ai/integrations/channels/imessage), [Mastra Channels](https://mastra.ai/docs/channels), [Photon adapter](https://github.com/photon-hq/vercel-chat-adapter-imessage).
