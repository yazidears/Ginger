# Local runtime memory and cloud readiness

Measured on 2026-09-19 with macOS `vmmap -summary` (physical footprint includes compressed memory):

- Main local web server, port 3002: 8.0 GiB; recorded peak 9.7 GiB.
- Demo server, port 3003: 1.3 GiB.
- Other Ginger development previews: 0.95 GiB and 1.8 GiB.
- Background worker: 371 MiB. No SAGE numerical worker was active at measurement.

The main development log showed ENOSPC followed by repeated `Failed to flush logs to file: RangeError: Invalid string length`. Next 16.3.5's `server/dev/browser-logs/file-logger.js` retains its queue when a flush fails and logs the failure through console.error. This is a likely source of unbounded retention; it was not proven with a heap snapshot.

`next.config.ts` disables the optional Next development MCP server (which enables that file logger), retains ordinary terminal/browser logs, and enables the documented webpack memory optimization. `npm run dev` now sets a 3072 MiB V8 old-space limit. This is a heap limit, not a cap on total process memory. The existing local.ginger.web launch agent has the same limit in NODE_OPTIONS and was restarted. Other tasks' preview servers were left running.

The demo dark basemap overzooms Esri z16 tiles: actual tiles at z17-z19 for the saved run return the same no-data placeholder. Demo wind and playback panels have separate vertical positions.

## Cloud options checked

Read-only SSH to the existing SCUFF host succeeded. It has 2 CPUs, 7.8 GiB RAM (4.2 GiB available at inspection), 8.2 GiB free disk, Node 20.20.0 and a working user systemd manager. No cloud service was deployed or provisioned.

For regular testing, prefer a separate CPU VM with explicit resource limits, a production Next build, and separate web/background workers. Preserve saved `.sage-runs`, `.ginger-data`, dated geography artifacts, and provider configuration. Python geography/satellite dependencies must be installed for Linux, not copied from the macOS virtualenv. Validate the real worker and saved-run flow before retiring local services. A private SSH tunnel is suitable for an initial trial; an Internet-facing deployment needs its intended access controls in place. No GPU is used by the current SAGE engine.
