# ADR-0004: Data sources, projection and formats

- Status: Accepted (2026-11-14)
- Deciders: backend-senior, database-architect, security-senior, qa-senior

## Decision
- Terrain: USGS Astrogeology *Mars 2020 Terrain Relative Navigation HiRISE mosaics* (CC0): DTM 1 m doi:10.5066/P9REJ9JN and orthomosaic 0.25 m doi:10.5066/P9QJDP48 (corrected 2026-11-14: the 2025 MSR TRN release doi:10.5066/P13CPYYU was considered in the kickoff but the files actually used are the Mars 2020 TRN mosaics): DEM 1 m (Float32) + orthomosaic 25 cm (8-bit, RED band) on the **same grid** (ortho = 4× DEM) → alignment by construction. Read by window over HTTP range requests (no 9 GB download), cached with SHA-256 in `sources.lock.json`.
- Region: ~2 × 2 km crossing Perseverance's real traverse on the delta (DEM ∩ ortho ∩ CRISM coverage).
- **Projection**: sources are equirectangular with `lat_ts = 0`; at ~18.4°N the east–west axis is stretched 5.4 %. We reproject to a local equirectangular with `lat_ts` = region centre so pixels are true metres before computing slopes, meshes or routes.
- Vertical datum: the DEM's (MOLA geoid). Traverse elevations reprojected from lon/lat (not from the feed's eastings).
- Formats: raw `Uint16` LE heights + scale/offset/nodata; binary layers (u8/f32) with encoding in the manifest; COG Float32 as canonical Python artefact; GeoJSON for vectors; Parquet for training episodes.
- Validated science layers: Perseverance traverse & waypoints (JPL MMGIS, frozen copy) — also used to validate DEM slope against the rover's measured tilt; CRISM mineral map (Zenodo 5575824, CC-BY 4.0, ML-derived — stated in UI); MEDA weather sols (PDS).
- Attribution panel lists every source and the disclaimer "Not affiliated with or endorsed by NASA, JPL or Caltech".

## Alternatives discarded
- Caltech Murray Lab DEM: broken TLS chain — disabling verification is vetoed.
- UAHiRISE `.IMG` DTMs: PDS3 format, 700 MB per DTM; USGS mosaic already provides aligned GeoTIFFs.
- Mars Trek STL/OBJ export: loses georeference and the planning grid.
- data.nasa.gov CSVs: nothing spatially usable for Jezero.

## Validation results (2026-11-14, `validation_report.json`)
- DEM height vs Perseverance published elevation at 147 waypoints: Pearson 0.99999, MAE 2.7 cm, bias -2.5 mm.
- DEM slope vs rover measured tilt: Pearson 0.84 (1 m) / 0.91 (1.5 m smoothing), bias +0.45 deg, MAE 1.9 deg; pitch r = 0.93, roll r = 0.95.
- DEM to ortho alignment: global offset 0.66 DEM px (< 1 px); local patches median 0.76 px, p95 1.58 px (hillshade-vs-image NCC measurement noise; both products come from the same USGS mosaic).
