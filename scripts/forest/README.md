# Ginger forest research workspace

`/forest` adds six ICGC regional forest heatmaps, selectable 3D crowns reconstructed from real classified LiDAR, weather forecasts, and native ELMFIRE sensitivity ensembles driven by WindNinja terrain wind. It is a private research implementation, not a validated detection or warning system.

## Evidence and coverage

- Catalonia catalog: 33,122 one-kilometre tiles, EPSG:25831. The catalog is regional; **individual trees exist only in completed tiles**. On 19 September 2026, tiles 423586, 423587, 424586 and 424587 contained 29,516 detected crowns.
- LiDAR campaign: 2021–2023. LAS creation dates are retained separately and are not acquisition dates. SHA-256 and source URLs are stored per tile.
- Crown detection: streaming classified returns → 1 m ground/canopy surfaces → local maxima → watershed. Heights, crown areas and positions are estimates; suppressed trees, merged crowns and boundary duplicates are unresolved. Crown shapes and stems in the viewer are illustrative. Species are unknown, not randomly assigned.
- Regional WMS density, height, cover, biomass, foliage and diameter are historical **2016–2017** estimates, distinct from the tree inventory.
- Weather mode repeats a point forecast for orientation. Fire mode displays actual WindNinja vectors from a completed scenario at 6.096 m, initialized from the scenario's 10 m wind.
- Fire calculations use **20 m landscape cells**, not a combustion model of each tree. Native ELMFIRE 2025.0717 has one documented local pointer-initialization patch. WindNinja commit: `bfc6095366530d8fd2b7d056b925d6a030a176da`.
- Fuel model 8 is an explicit proxy under >=10% canopy. Open vegetation is unmapped and excluded; roads/buildings inside canopy cells are unresolved. This limits real-world validity. Moisture, crown base and bulk density are assumptions. Nine members perturb speed, direction and moisture; fractions are sensitivity outcomes, not calibrated probabilities. Crown/spotting are off by default.
- Native grids, configuration files, logs, member parameters and output GeoTIFFs are retained under `ginger-data/runs/<id>`. The map uses conditional median arrival and final ensemble fraction; its color is not a time-varying probability.

## Run and reconnect

Private VM: `ginger-forest-lab`, project `ginger-wildfire-intelligence`, zone `europe-southwest1-a`. E2 standard 16, 200 GB balanced boot disk, Ubuntu 24.04. Only IAP SSH ingress is enabled. No public app listener is required.

```sh
gcloud compute ssh ginger-forest-lab \
  --project=ginger-wildfire-intelligence --zone=europe-southwest1-a \
  --tunnel-through-iap -- -N -L8788:127.0.0.1:8788
# In a second terminal, from the repository:
./scripts/forest/preview.sh
# Or run the whole Ginger app and visit /forest.
```

The standalone preview copies only this feature to `~/.cache/ginger-forest-preview` to avoid iCloud-offloaded source files blocking Next. Its links to other Ginger workspaces require the full app. The actual feature source remains in this repository. The worker is a separate service; a disconnected worker returns an explicit 503 rather than synthetic trees.

Worker paths:

- Python: `/home/yazidears/ginger-tools/python/bin/python`
- Source: `/home/yazidears/ginger-tools/forest/`
- Data: `/home/yazidears/ginger-data/`
- Service: `ginger-forest.service`, localhost:8788, two jobs at a time, MemoryMax=40G, CPUQuota=1200%.
- Engine: `/home/yazidears/ginger-tools/elmfire/build/linux/bin/elmfire_2025.0717`
- WindNinja: `/usr/local/bin/WindNinja_cli`

Install Python dependencies from `requirements-forest.txt`. Build ELMFIRE tag `2025.0717` (commit `168c8d4186fa0854ec7615732532fbcf820680c8`) with GNU Fortran/OpenMPI/GDAL; first run `python patch-elmfire.py /path/to/elmfire`, then `cd build/linux && bash make_gnu.sh`. The patch initializes a local pointer before `ASSOCIATED(C)`; without it this build crashed before propagation. It changes no spread equations. Build WindNinja with CMake, CLI enabled, GUI and NINJAFOAM disabled; install its shared data with the binary.

Worker environment: `GINGER_FOREST_DATA`, `ELMFIRE_BIN`. Start `uvicorn service:app --host 127.0.0.1 --port 8788` from `scripts/forest`. The Next proxy accepts `GINGER_FOREST_SERVICE` (default localhost:8788). Do not expose the unauthenticated worker publicly.

## Validation

```sh
node node_modules/typescript/bin/tsc -p tsconfig.forest.json
# On the worker, with its virtualenv and catalog:
cd /home/yazidears/ginger-tools/forest
GINGER_FOREST_DATA=/home/yazidears/ginger-data ../python/bin/python test_service.py
```

Seven tests cover coordinate round trips, crown separation, zero-canopy behavior, missing ground, interpolation, invalid bounds and wind direction validation. A real four-tile reconstruction and nine-member native run were exercised. Desktop browser checks cover rendering, crown inspection, weather and fire results. These checks do not establish historical fire predictive accuracy. Full repository checks are separate from this feature's isolated checks.

## Server lifetime and retention

The VM is scheduled to **STOP at 2026-09-20 21:59 UTC (23:59 Europe/Madrid)**. Stop does not delete the boot disk; disk charges continue until deletion. Billing is enabled, but credit eligibility/balance was not verified.

Raw LAZ downloads are deleted after processing. Completed trees, rasters and metadata remain on the worker. Use `backup.sh` before deleting the VM: it makes a SQLite-consistent snapshot and streams a compressed archive to your Mac, independent of the VM disk. Restore by extracting the archive, restoring `forest-backup.sqlite` as `forest.sqlite`, and starting the worker with the restored data root. The startup handler marks interrupted jobs retryable.

Full Catalonia reconstruction, species enrichment, cross-tile crown reconciliation, validated surface fuels, historical fire calibration and stronger live ignition detection remain additional work. Do not interpret the 33,122-tile catalog as a completed one-to-one forest census.

Sources: [ICGC LiDAR](https://datacloud.icgc.cat/datacloud/lidar-territorial/), [forest WMS](https://geoserveis.icgc.cat/servei/catalunya/variables-biofisiques-arbrat/wms), [orthophoto WMTS](https://www.icgc.cat/en/Mapes-i-geoinformacio/Dades-i-productes/Online-services-Geoservices/WMS-and-tiles-Reference-cartography/Fast-WMSWMTS-raster-cartography/WMTS-raster-cartography-non-UTM-coordinates), [ELMFIRE](https://github.com/lautenberger/elmfire), [WindNinja](https://github.com/firelab/windninja), [Open-Meteo](https://open-meteo.com/).
