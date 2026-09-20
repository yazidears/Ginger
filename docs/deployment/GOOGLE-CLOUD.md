# Private Google Cloud deployment

Target: `ginger-forest-lab`, project `ginger-wildfire-intelligence`, zone
`europe-southwest1-a`. This reuses the existing E2 standard 16 VM and its existing
ELMFIRE/WindNinja service. No extra VM, load balancer, public firewall rule or DNS
record is needed.

## Verified AshConnect deployment, 2026-09-20

Selected release: `20260920T093000Z-ashconnect`. It layers AshConnect and its
dependencies on the previous cloud source, preserving unrelated local product
experiments outside the release. Its final worker-only prompt patch inherits the
unchanged web build from `20260920T092000Z-ashconnect`. All 214 application,
integration and cloud-script hashes matched the deployment manifest.

The production Next build, web/messaging/forest type checks, 42 messaging tests,
19 provider reliability checks, snapshot/receptivity tests and monitor scheduler
regression passed on the VM. Web, monitor, forest and messaging services are
active. Telegram's authenticated bridge reports `AshConnectBot`; Nebius lists
the configured `zai-org/GLM-5.3-Flash` model. Messaging credentials and the shared
operator token are private in `shared/.env.local`; the cloud is the sole Telegram
poller. The HTTPS webhook proxy remains disabled.

The stale monitoring snapshot was repaired by keeping GIS work separate from
monitor publication and enforcing settlement of timed-out provider fetch/body
promises. Real `lastScan` timestamps advanced from `09:22:11.430Z`, to
`09:29:12.603Z` after a saved-location change, and to `09:32:07.655Z` on the
unmodified ten-minute timer. Publication also continued each minute. The final
scan contained seven areas with current weather/satellite coverage, retaining
the providers' original retrieval times. This is monitoring evidence, not an
all-clear or a calibrated fire prediction.

The deployed AshConnect page was rendered through the private IAP tunnel.
Worker health and authenticated bridge returned HTTP 200 with fresh data.
Only loopback ports 3000, 4112 and 8788 listen; no public app or callback was
exposed. These deployment checks did not register recipients or send messages.
Physical/message delivery acceptance is recorded separately from service health.

## Verified deployment, 2026-09-19

Release `20260919T181507Z` contains Git base
`496ea2c207efcd6d8d4bccf9a34585b99ba5dd2c` plus the working-tree runtime changes
recorded in its manifest. Later local changes are not automatically deployed.

The complete Next production build, TypeScript build checks, backend snapshot
tests, receptivity tests and forest TypeScript check passed on the VM. The home,
forest, forest-status, receptivity and workspace endpoints returned HTTP 200.
The new worker published 29,813 assessed cells from 18 XEMA stations at
18:18:55 UTC. The existing forest service reported four completed tiles and
29,516 crowns. The rendered home map was checked through the private tunnel.
This verifies hosting and those paths; it does not validate every optional
integration or the scientific accuracy of the models.

## Access

Run from a machine with the existing Google Cloud identity and SSH access:

```sh
bash scripts/cloud/tunnel.sh
```

Then open http://localhost:3004. The URL forwards to Google Cloud; the Mac only
provides the authenticated tunnel. Closing the tunnel does not stop cloud jobs.
Use `GINGER_LOCAL_PORT=3005` if port 3004 is occupied. The Next server listens only
on VM loopback. The forest worker remains on loopback port 8788.

## Runtime

- `/home/yazidears/ginger-app/releases/<UTC timestamp>`: immutable source snapshot,
  dependencies, production build and `deployment-manifest.json` with source hashes.
- `/home/yazidears/ginger-app/current`: selected release.
- `/home/yazidears/ginger-app/shared/.env.local`: private server credentials (0600).
- `/home/yazidears/ginger-app/shared/.ginger-data`: persistent caches and watch areas.
- `/home/yazidears/ginger-app/shared/snapshots`: background assessment results.
- `/home/yazidears/ginger-app/shared/sage-runs`: persistent simulation jobs.
- `ginger-web.service`: production Next server, port 3000, 8 GB memory limit.
- `ginger-worker.service`: continual background refresh, 12 GB memory limit.
- `ginger-messaging.service`: optional AshConnect/Mastra worker, loopback 4112,
  2 GB memory limit. It shares the web app's watch areas, messaging database and
  subscriptions in `shared/.ginger-data`, and reads `shared/snapshots`.
- `ginger-webhook-proxy.service`: optional webhook-only proxy, loopback 4113,
  256 MB memory limit. It exposes no app, health or operator routes.
- `ginger-forest.service`: existing independent LiDAR and native simulation worker.

The two new services each have a four-CPU quota to leave compute for the existing
forest engine. All use the same VM. More CPUs alone do not remove the application's
existing per-job concurrency limits. The Photon/Vonage messaging worker can run on
Linux; the separate Ash iOS client is not a cloud service.

## Release procedure

Package the required tracked source from `git archive`, then overlay current
modified and untracked runtime files. This avoids iCloud hydration delays on
unchanged files. Capture the Git SHA, dirty file list and SHA-256 of each packaged
file in `deployment-manifest.json`. Never package `.env.local`, `.git`, macOS
`node_modules`, or local build directories in the source archive.

Transfer a source archive with `gcloud compute scp --tunnel-through-iap` and extract
it into a new release directory. Provision `shared/.env.local` separately with mode
0600. Seed environmental data once, retaining its original timestamps. Do not
replace existing cloud data on later releases.

Run `bash <release>/scripts/cloud/install-release.sh <release>` on the VM. It installs
locked root and messaging dependencies, builds the entire app, runs backend,
receptivity and messaging tests plus forest/messaging type checks, and only then
switches the current release and starts services. The current messaging worker
stops before switching releases, so two workers cannot share the same state.
Failed activation or startup health checks restore the previous release, service
definitions and enabled states if a previous release exists. The
independent forest service is not restarted by web releases.

## AshConnect messaging

Provision credentials only in `shared/.env.local` (mode 0600), which the worker
loads itself. Do not put API keys in unit files, archives, manifests or shell
history. The web app and worker must use the same `ASHCONNECT_OPERATOR_TOKEN`
(at least 32 random characters).

For Telegram, configure `ASHCONNECT_ENABLED=true`,
`ASHCONNECT_TRANSPORT=telegram`, `TELEGRAM_BOT_TOKEN`, and valid inference provider
settings. The worker verifies the bot's public username through `getMe`; an
optional `GINGER_TELEGRAM_BOT_USERNAME` must match that identity. Telegram
uses outbound long polling and requires no public tunnel or webhook proxy. Keep
`GINGER_WEBHOOK_PROXY_ENABLED` unset for this transport. Its polling cursor and
known conversations persist under `shared/.ginger-data/imessage/telegram.json`.

For Vonage WhatsApp, configure `ASHCONNECT_ENABLED=true`,
`ASHCONNECT_TRANSPORT=vonage`, `VONAGE_API_KEY`, `VONAGE_API_SECRET`,
`VONAGE_WHATSAPP_SENDER` (E.164 digits without `+`), `VONAGE_WEBHOOK_TOKEN`
(at least 32 random characters), and valid inference provider settings. Set
`VONAGE_SIGNATURE_SECRET` when signed Vonage webhooks are available. Legacy
`IMESSAGE_ENABLED=true` also enables the worker; Photon requires its project and
webhook credentials. The default worker port remains `IMESSAGE_PORT=4112`.

`GINGER_WEBHOOK_PROXY_ENABLED=true` additionally starts the narrow proxy. The
installer does **not** install a public tunnel, open firewall ports, register DNS,
or publish the application. A separately provisioned HTTPS endpoint may forward
only to `http://127.0.0.1:4113` (override with `GINGER_WEBHOOK_PROXY_PORT`). Never
point a public tunnel at port 3000, 4112 or 8788.

Only these exact POST paths are forwarded, preserving signed bytes and query:

- `/api/agents/ginger-watch/channels/imessage/webhook`
- `/api/agents/ginger-watch/channels/whatsapp/webhook?token=<private webhook token>`
- `/api/agents/ginger-watch/channels/whatsapp/status?token=<private webhook token>`

Keep complete Vonage callback URLs private: the query authenticates the provider
when its sandbox cannot sign callbacks. Avoid access logs containing the query.
The proxy returns 404 for `/internal/ash-connect`, `/health`, the web app and all
other paths. It also enforces a 256 KB request limit and upstream timeout. The
worker still performs the provider authentication; the proxy does not replace it.

For an explicitly approved temporary event endpoint, an outbound Cloudflare
tunnel can target the proxy without changing inbound firewall rules:

```sh
cloudflared tunnel --url http://127.0.0.1:4113
```

A quick tunnel URL can change after restart. A persistent production callback
requires a named tunnel/domain or another stable TLS endpoint. As inspected on
2026-09-20, this VM had no tunnel/proxy binary or configured public hostname;
Cloud DNS was not enabled in this project.

Validate the process with `curl -fsS http://127.0.0.1:4112/health` and the services
with `systemctl is-active ginger-messaging ginger-webhook-proxy`. Snapshot
freshness is reported separately from process health. Complete an inbound WATCH,
an evidence-backed response, one labelled test update, ACK/STOP, and worker
restart before claiming end-to-end messaging works. Provider acceptance alone
does not prove handset delivery. Do not send a test to every subscriber.

Run the proxy isolation regression locally with
`node --test scripts/cloud/webhook-proxy.test.cjs`.

## Operations and lifetime

```sh
sudo systemctl status ginger-web ginger-worker ginger-forest
sudo journalctl -u ginger-web -u ginger-worker --since '10 minutes ago'
curl -fsS http://127.0.0.1:3000/api/forest/status
```

As verified on 2026-09-19, the existing VM is scheduled to stop on
**2026-09-20 at 21:59 UTC (23:59 Europe/Madrid)**. This deployment preserves that
cost boundary. Persistent disk charges continue while stopped. Keeping it running
beyond that deadline requires deliberately changing the existing schedule. Do not
claim continuous availability past the deadline.

The application currently has no general operator login. Sharing a public URL is a
separate access decision; do not expose the raw app or forest service by opening
their ports. Google documents the current authenticated tunnel mechanism at
https://docs.cloud.google.com/iap/docs/using-tcp-forwarding.
