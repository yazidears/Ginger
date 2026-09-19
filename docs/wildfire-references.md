# Wildfire references

The shared catalogue in `src/lib/wildfire-references.ts` supplies prevention,
detections, changes, inspection, prevention plans, intelligence briefing exports,
and live/demo source directories.

- **Watch Duty:** external US incident map and alerts. No incident ingestion,
  notification subscription, or Catalonia coverage is implied.
- **Focs.cat:** external Catalan incident map. No feed is ingested and its reports
  are not automatically treated as verified Ginger incidents.
- **FireScope / INSAIT:** optional 2026 annual research risk raster in Map layers.
  It does not contribute to Ginger alert triggers, assessment scores, simulations,
  or evacuation decisions. Briefings list it as an external reference, not evidence.

## Map implementation

The raster URL templates, bounds, TMS orientation, 256px tile size and native
zoom limit of 12 come from the public map at https://firescope.ai/ (reviewed
2026-09-19). Europe and Asia have separate pyramids. The layer is off by default,
loaded on demand, and includes publisher attribution and an annual-risk legend.
Blank or missing tiles are no data, never an all-clear.

`/api/firescope/[region]/[z]/[x]/[y]` proxies only those two fixed publisher
paths because the upstream currently omits browser CORS response headers.
Coordinates are bounded; redirects are rejected; requests time out after 10s.
Only image/webp responses succeed. Missing coverage stays 404 and failures return
502; successful images are cached for one day. No credentials are required.
The public tile service has no availability guarantee.

Run `npx tsx scripts/test-wildfire-references.ts` for catalogue separation and
route validation/error checks, and `npm run typecheck` for TypeScript validation.
