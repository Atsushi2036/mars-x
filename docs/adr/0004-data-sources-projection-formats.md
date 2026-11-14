# ADR-0004: Data sources, projection and formats

- Status: Accepted (2026-11-14)
- Deciders: backend-senior, database-architect, security-senior, qa-senior

## Decision
- Terrain: USGS *Mars Sample Return HiRISE Mosaics for Terrain Relative Navigation* (CC0, doi:10.5066/P13CPYYU): DEM 1 m (Float32) + orthomosaic 25 cm (8-bit, RED band) on the **same grid** (ortho = 4× DEM) → alignment by construction. Read by window over HTTP range requests (no 9 GB download), cached with SHA-256 in `sources.lock.json`.
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
