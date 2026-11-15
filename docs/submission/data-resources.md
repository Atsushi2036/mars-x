# MARS-X — Data, resources and tools (References field)

Sources of truth for this list:
- `data/processed/jezero-v1/manifest.json` (every layer's source, licence and SHA-256);
- `docs/adr/0004-data-sources-projection-formats.md`;
- `apps/explorer/src/features/sources/extras.ts`;
- `apps/explorer/package.json` and `python/pyproject.toml`.

The same credits appear in the app (Data → Data sources).

> Not affiliated with or endorsed by NASA, JPL or Caltech. No NASA, JPL or mission logos are used.

## NASA data and resources (required: at least one)

| # | Resource | Used for | Credit / licence | Link |
|---|---|---|---|---|
| 1 | Mars 2020 Terrain Relative Navigation HiRISE DTM mosaic (MOLA topography, DeltaGeoid), 1 m | Terrain, slope, roughness, step, hazard, horizon, sky view, normals, planning grid | USGS Astrogeology Science Center; NASA/JPL/University of Arizona (HiRISE). CC0-1.0. doi:10.5066/P9REJ9JN | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif |
| 2 | Mars 2020 TRN HiRISE orthorectified image mosaic (RED), 0.25 m | Surface texture (false-colour tint of a single monochrome band) | USGS Astrogeology Science Center; NASA/JPL/University of Arizona (HiRISE). CC0-1.0. doi:10.5066/P9QJDP48 | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif |
| 3 | Mars 2020 Perseverance traverse (MMGIS) | Real rover path, used as reference and for validation | NASA/JPL-Caltech, Mars 2020 MMGIS. NASA public data (no licence text published). Frozen copy, retrieved 2026-11-14 | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json |
| 4 | Mars 2020 Perseverance waypoints (MMGIS) | Science stops; validation of DEM height and slope against the rover's elevation and tilt | NASA/JPL-Caltech, Mars 2020 MMGIS. NASA public data. Frozen copy, retrieved 2026-11-14 | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json |
| 5 | Mars 2020 MEDA environmental data (bundle mars2020_meda, release 2026-08-11) | Air temperature, pressure and wind for sols 148, 151, 160, 170, 313, 314, 315 | NASA Planetary Data System, Atmospheres Node. NASA public data | https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html |
| 6 | Mars24 sun position algorithm | Sun azimuth and elevation by local time; shadows | NASA GISS Mars24; Allison & McEwen 2000, Planetary and Space Science 48, 215–235. Algorithm | https://www.giss.nasa.gov/tools/mars24/help/algorithm.html |
| 7 | NSSDC Mars Fact Sheet | Gravity and solar irradiance at Mars | NASA National Space Science Data Center Archive (NSSDCA). NASA public data | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html |
| 8 | Approximate positions of the planets | Earth–Mars one-way light-time by date | NASA/JPL Solar System Dynamics. Algorithm | https://ssd.jpl.nasa.gov/planets/approx_pos.html |
| 9 | Perseverance power system (MMRTG), Mars 2020 press kit | RTG rover power, about 110 W at the start of the mission | NASA/JPL-Caltech. NASA public data | https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/mission/spacecraft/power/ |
| 10 | Solar radiation on Mars (Appelbaum & Flood 1990, NASA TM-103623) | Surface insolation from sun height and dust opacity | NASA Technical Memorandum. Cited publication | https://ntrs.nasa.gov/citations/19910005804 |
| 11 | Mars 2020 Perseverance Rover 3D model (NASA 3D Resources) | Rover model. Modified: geometry simplified, textures resized to 512 px WebP, meshopt-compressed with gltf-transform 4.5.1 | NASA/JPL-Caltech. Assets free and without copyright per the collection's README; used without implying endorsement | https://github.com/nasa/NASA-3D-Resources |
| 12 | Interplanetary Survival Guide: Martian Map (challenge statement and resources) | Problem definition | NASA Space Apps Challenge 2026 | https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/ |

## Other data and publications

| # | Resource | Used for | Credit / licence | Link |
|---|---|---|---|---|
| 13 | Jezero crater CRISM mineral map | Spectral layer (mineral classes) and the Mg-carbonate science stop. An ML-derived product, stated in the app | M. Parente, Y. Itoh, A. M. Saranathan (UMass Amherst), Zenodo 5575824. CC BY 4.0. CRISM data: NASA/JPL-Caltech/MSSS/JHU-APL | https://doi.org/10.5281/zenodo.5575824 |
| 14 | THEMIS-derived thermal inertia of Jezero crater | Thermal layer and soil slip class (100 m/px) | C. S. Edwards, J. Buz (Northern Arizona University); THEMIS / 2001 Mars Odyssey (NASA/JPL-Caltech/ASU). CC BY 4.0 | https://doi.org/10.5281/zenodo.4931348 |
| 15 | Dust opacity of the January 2022 regional storm | Storm-sol dust opacity (tau ≈ 2; a published peak value, not a per-sol measurement) | Lemmon et al. 2022, Geophysical Research Letters 49(17), e2022GL100126 | https://doi.org/10.1029/2022GL100126 |
| 16 | Rock size-frequency model | Synthetic rocks below the terrain resolution (L3). The rocks are synthetic | Golombek & Rapp 1997, Journal of Geophysical Research 102(E2), 4117–4129 | https://doi.org/10.1029/96JE03319 |
| 17 | SPL metric | Success weighted by path length in the scorecard | Anderson et al. 2018, "On Evaluation of Embodied Navigation Agents" | https://arxiv.org/abs/1807.06757 |

Before the final submission, confirm that rows 15–17 match the references shown in the app's Data panel. Do not
list a source the app does not use. gltf-transform 4.5.1 (MIT) was also used offline to compress the rover model.

## Open-source software

### Web app (`apps/explorer/package.json`, exact versions)

| Software | Licence | Use |
|---|---|---|
| React 19.3.1, React DOM | MIT | UI |
| three.js 0.187.0 | MIT | 3D rendering |
| @react-three/fiber 9.8.2, @react-three/drei 10.7.9 (Poimandres) | MIT | React bindings for three.js |
| ONNX Runtime Web 1.31.1 (Microsoft) | MIT | Runs user ONNX policies in WebAssembly |
| Radix UI 1.8.1, shadcn/ui 4.23.0, class-variance-authority, tw-animate-css | MIT | Interface components |
| Tailwind CSS 4.3.5 | MIT | Styling |
| zustand 5.1.0, zod 4.6.7, Comlink 4.4.2 | MIT / Apache-2.0 (Comlink) | State, validation, Web Workers |
| lucide-react 1.70.0 | ISC | Icons |
| sonner 2.0.8 | MIT | Notifications |
| Geist and Geist Mono via @fontsource-variable 5.3.0 (Vercel) | SIL OFL 1.1 | Typography |
| Vite 8.3.5, TypeScript 6.0.3, Vitest 5.1.0, Playwright 1.65.0, ESLint 10, sharp 0.35.5 | MIT / Apache-2.0 | Build, tests, screenshots |

### Python SDK and pipeline (`python/pyproject.toml`)

| Software | Licence | Use |
|---|---|---|
| NumPy, SciPy | BSD-3-Clause | Numerics |
| Numba | BSD-2-Clause | Parallel layer computation |
| pydantic, jsonschema | MIT | Contracts and JSON Schema |
| Gymnasium 1.4 (Farama Foundation) | MIT | Environment API of the SDK |
| rasterio, pyproj | BSD-3-Clause / MIT | Geospatial reads and reprojection |
| Pillow, requests | MIT-CMU / Apache-2.0 | Images, HTTP |
| PyTorch (CPU), Stable-Baselines3 2.9 | BSD-3-Clause / MIT | Training the reference PPO policy |
| ONNX, onnxscript, onnxruntime | Apache-2.0 / MIT | Policy export and checks |

### Services and tools

- GitHub and GitHub Actions (CI).
- Cloudflare Pages (static hosting).
- pnpm and uv (package managers).
- Google Colab (SDK notebook).

### AI assistance

Claude Code (Anthropic). See `ai-use.md`.

## Before submitting

Check every licence above against the installed package (`pnpm licenses list`, `uv pip list`) and the
`public/models/CREDITS.txt` file.
