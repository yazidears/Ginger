# Public Ginger demo

The public demo is https://ginger.scuff.now/prevent. SCoFF Cloud terminates HTTPS
and forwards through `scripts/cloud/public-demo-proxy.cjs` to the isolated demo
on the existing `ginger-forest-lab` VM. It does not depend on a Mac or local tunnel.

## Services and state

- SCoFF Cloud: `ginger-demo-gateway.service`, loopback port 23060; nginx site
  `ginger.scuff.now`; automatically renewed Let's Encrypt certificate.
- Ginger VM: `ginger-public-demo.service`, port 3052. The firewall permits only
  SCoFF Cloud's address on this port. The private web application remains on 3000.
- Release: `/home/yazidears/ginger-demo/releases/public-42fa713`.
- Demo state and configuration: `/home/yazidears/ginger-demo/shared`.
- The demo shares public environmental/exposure data and the existing forest
  engine, while rooms, scenarios, operations, and Sage runs use separate state.
- `GINGER_PUBLIC_DEMO=1` allows Ash room creation without an operator access
  token. Signed room memberships, origin checks and request limits remain active.
  Set this only on an isolated public demo. A private room-signing secret is still
  required and is never sent to visitors.
- Messaging worker credentials and private subscriptions are not copied into the
  demo. Real alert delivery is not enabled on this instance.

The production build passed on the VM. Live HTTPS checks verified the rendered
Prevent map, 29,813 environmental cells, a saved hypothetical Sage forecast,
Ash's token-free catalog, and the forest endpoint (8 tiles / 60,733 crowns at
verification). Gzip reduces the regional response from about 33 MB to 3.4 MB.
These checks do not claim physical microphone acceptance or real alert delivery.

The previous VM termination time was removed with explicit user approval on
2026-09-20. The VM remains running with ongoing cloud charges.

The temporary trycloudflare link also points at this cloud gateway, but its name
can change after its tunnel process restarts. Share the custom HTTPS domain.
