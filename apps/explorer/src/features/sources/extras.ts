import type { Provenance } from '../shared/provenance'

/**
 * Sources that are not map layers: atmosphere, astronomy, physical constants and the open-source software the
 * benchmark runs on. Layer sources (terrain, imagery, minerals, traverse, thermal inertia, sun and light-time
 * tables) are rendered from the dataset manifest instead, so their credit text can never drift from the data.
 */
export interface ExtraSource {
  id: string
  group: 'Atmosphere and physics' | 'Software'
  title: string
  credit: string
  license: string
  url: string
  doi?: string
  use: string
  provenance?: Provenance
}

export const EXTRA_SOURCES: readonly ExtraSource[] = [
  {
    id: 'meda',
    group: 'Atmosphere and physics',
    title: 'Mars 2020 MEDA environmental data',
    credit: 'NASA Planetary Data System, Atmospheres Node. Bundle mars2020_meda, release 2026-08-11.',
    license: 'NASA public data (no licence text published)',
    url: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    use: 'Air temperature, pressure and wind per sol.',
    provenance: 'measured',
  },
  {
    id: 'lemmon',
    group: 'Atmosphere and physics',
    title: 'Dust opacity of the January 2022 regional storm',
    credit: 'Lemmon et al. 2022, Geophysical Research Letters 49(17), e2022GL100126.',
    license: 'Cited publication',
    url: 'https://doi.org/10.1029/2022GL100126',
    doi: '10.1029/2022GL100126',
    use: 'Dust opacity (tau about 2) for the storm sols. A peak value, not a per-sol measurement.',
    provenance: 'derived',
  },
  {
    id: 'mars24',
    group: 'Atmosphere and physics',
    title: 'Mars24 sun position algorithm',
    credit: 'Allison & McEwen 2000, Planetary and Space Science 48, 215-235. NASA GISS Mars24.',
    license: 'Algorithm (no data licence)',
    url: 'https://www.giss.nasa.gov/tools/mars24/help/algorithm.html',
    use: 'Sun azimuth and elevation by local time.',
    provenance: 'modeled',
  },
  {
    id: 'nssdc',
    group: 'Atmosphere and physics',
    title: 'Mars Fact Sheet',
    credit: 'NASA National Space Science Data Center Archive (NSSDCA).',
    license: 'NASA public data (no licence text published)',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
    use: 'Gravity and solar irradiance at Mars.',
    provenance: 'derived',
  },
  {
    id: 'appelbaum',
    group: 'Atmosphere and physics',
    title: 'Solar insolation on Mars',
    credit: 'Appelbaum & Flood 1990, NASA Technical Memorandum 103623.',
    license: 'Cited publication',
    url: 'https://ntrs.nasa.gov/citations/19910005804',
    use: 'Sunlight at the surface from sun height and dust opacity.',
    provenance: 'modeled',
  },
  {
    id: 'golombek',
    group: 'Atmosphere and physics',
    title: 'Rock size-frequency model',
    credit: 'Golombek & Rapp 1997, Journal of Geophysical Research 102(E2), 4117-4129.',
    license: 'Cited publication',
    url: 'https://doi.org/10.1029/96JE03319',
    doi: '10.1029/96JE03319',
    use: 'Synthetic rocks below the terrain resolution (level L3). The rocks are synthetic.',
    provenance: 'modeled',
  },
  {
    id: 'mmrtg',
    group: 'Atmosphere and physics',
    title: 'Perseverance power system (MMRTG)',
    credit: 'NASA/JPL-Caltech, Mars 2020 press kit.',
    license: 'NASA public data (no licence text published)',
    url: 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/mission/spacecraft/power/',
    use: 'Power of the RTG rover profile (about 110 W at the start of the mission).',
    provenance: 'derived',
  },
  { id: 'gymnasium', group: 'Software', title: 'Gymnasium 1.x', credit: 'Farama Foundation.', license: 'MIT', url: 'https://gymnasium.farama.org/', use: 'Environment API of the Python SDK.' },
  { id: 'sb3', group: 'Software', title: 'Stable-Baselines3 2.9.2', credit: 'DLR-RM contributors.', license: 'MIT', url: 'https://stable-baselines3.readthedocs.io/', use: 'Trains the reference PPO policy.' },
  { id: 'ort', group: 'Software', title: 'ONNX Runtime Web 1.31.1', credit: 'Microsoft.', license: 'MIT', url: 'https://onnxruntime.ai/', use: 'Runs your ONNX policy in the browser (WebAssembly).' },
  { id: 'three', group: 'Software', title: 'three.js and React Three Fiber', credit: 'three.js authors; Poimandres.', license: 'MIT', url: 'https://threejs.org/', use: '3D terrain rendering.' },
  { id: 'ui', group: 'Software', title: 'React, Radix UI, shadcn/ui, Tailwind CSS', credit: 'Meta; WorkOS; shadcn; Tailwind Labs.', license: 'MIT', url: 'https://ui.shadcn.com/', use: 'Interface components.' },
  { id: 'geist', group: 'Software', title: 'Geist and Geist Mono fonts', credit: 'Vercel.', license: 'SIL Open Font License 1.1', url: 'https://vercel.com/font', use: 'Typography.' },
]
