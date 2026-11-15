import type { LayerId } from '@/store/app'

/**
 * Overlay layer catalogue: what each layer is, how it is labelled and where its data comes from.
 * The shader ids must match LAYER_IDS in terrain-material.ts. Continuous layers use viridis (slope) or
 * cividis (hazard); the terrain's own red/orange ramp is never reused for data.
 */
export type RampName = 'viridis' | 'cividis'

export type Legend =
  | { kind: 'none' }
  | { kind: 'ramp'; ramp: RampName; stops: string[]; min: string; mid?: string; max: string; unit: string }
  | { kind: 'categorical'; items: Array<{ color: string; label: string }>; fromManifest?: boolean }
  | { kind: 'binary'; items: Array<{ color: string; label: string }> }

export interface LayerDef {
  id: LayerId
  label: string
  shaderId: number
  /** id of the manifest layer that holds the data (null = computed in the shader / nothing to load) */
  manifestId: string | null
  title: string
  description: string
  /** short provenance, shown next to the legend */
  sourceNote: string
  /** honesty tag next to the title */
  badge?: string
  legend: Legend
}

export const VIRIDIS_STOPS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']
export const CIVIDIS_STOPS = ['#00204d', '#31446b', '#666970', '#958f78', '#cbba69', '#ffea46']

/** Ordinal slip classes (loose = most likely to slip). Chosen from the cividis ramp so they stay readable for colour-blind users. */
export const SLIP_ITEMS = [
  { color: '#ffea46', label: 'Loose fines / sand' },
  { color: '#7c7b78', label: 'Mixed / indurated' },
  { color: '#00204d', label: 'Rock / bedrock' },
]

export const LAYER_DEFS: Record<LayerId, LayerDef> = {
  none: {
    id: 'none',
    label: 'None',
    shaderId: 0,
    manifestId: null,
    title: 'No overlay',
    description: 'Imagery only.',
    sourceNote: '',
    legend: { kind: 'none' },
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    shaderId: 1,
    manifestId: null,
    title: 'Slope',
    description: 'Angle of the surface from horizontal, from the 1 m elevation model.',
    sourceNote: 'USGS HiRISE DTM (CC0), derived by MARS-X',
    legend: { kind: 'ramp', ramp: 'viridis', stops: VIRIDIS_STOPS, min: '0°', mid: '15°', max: '30°+', unit: 'degrees' },
  },
  hazard: {
    id: 'hazard',
    label: 'Hazard',
    shaderId: 2,
    manifestId: 'plan_hazard',
    title: 'Traverse hazard',
    description: 'Worst of slope, ledge height and roughness against engineering limits (2 m cells). Planner cost layer.',
    sourceNote: 'USGS HiRISE DTM (CC0), derived by MARS-X; limits are team assumptions, not NASA limits',
    badge: 'Derived',
    legend: { kind: 'ramp', ramp: 'cividis', stops: CIVIDIS_STOPS, min: 'Benign', mid: '50%', max: 'At the limit', unit: 'share of limit' },
  },
  crism: {
    id: 'crism',
    label: 'Minerals',
    shaderId: 3,
    manifestId: 'crism',
    title: 'Mineralogy (CRISM)',
    description: 'Mineral classes identified from orbital spectra. Transparent where no class was identified or CRISM did not cover.',
    sourceNote: 'Parente, Itoh and Saranathan (UMass Amherst), Zenodo 10.5281/zenodo.5575824, CC BY 4.0; CRISM: NASA/JPL-Caltech/JHU-APL',
    badge: 'ML-derived map',
    legend: { kind: 'categorical', items: [], fromManifest: true },
  },
  slip: {
    id: 'slip',
    label: 'Wheel slip',
    shaderId: 4,
    manifestId: 'slip_class',
    title: 'Wheel-slip class (THEMIS)',
    description: 'Surface material class from night-time thermal inertia at 100 m/px. A proxy: it says nothing about wheel-soil mechanics at rover scale.',
    sourceNote: 'Edwards and Buz (NAU), Zenodo 10.5281/zenodo.4931348, CC BY 4.0; THEMIS: NASA/JPL-Caltech/ASU; class thresholds are team assumptions',
    badge: 'Proxy',
    legend: { kind: 'categorical', items: SLIP_ITEMS },
  },
  illum: {
    id: 'illum',
    label: 'Illumination',
    shaderId: 5,
    manifestId: 'horizon',
    title: 'Illumination',
    description: 'Cells in terrain shadow for the current sun, from horizon maps (rays up to 600 m, 2 m cells). Move the time of day to watch it change.',
    sourceNote: 'USGS HiRISE DTM (CC0); sun position by the Mars24 algorithm (Allison and McEwen 2000)',
    badge: 'Derived',
    legend: {
      kind: 'binary',
      items: [
        { color: '#f3d9b8', label: 'Lit by the sun' },
        { color: '#4a5a86', label: 'In terrain shadow' },
      ],
    },
  },
}

export const ORDERED_LAYERS: LayerId[] = ['none', 'slope', 'hazard', 'crism', 'slip', 'illum']

export type Availability = { ok: true } | { ok: false; reason: string }

export function layerAvailability(id: LayerId, manifest: { layers: ReadonlyArray<{ id: string }> }): Availability {
  const def = LAYER_DEFS[id]
  if (!def.manifestId) return { ok: true }
  if (manifest.layers.some((l) => l.id === def.manifestId)) return { ok: true }
  return { ok: false, reason: `Not in this dataset: no "${def.manifestId}" file was published.` }
}
