import { focusBounds, useCamera } from '@/store/camera'
import { useApp, type Mode } from '@/store/app'
import { useDay } from '@/store/day'
import { selectScienceTarget, setMissionEndpoints, setMissionProfile, useMission } from '@/store/mission'
import { useByo } from '../shared/byo-store'
import { useScenario } from '../scenario/store'
import { clickByRole, scrollInspectorTo, waitFor } from './dom'
import { pickWaypoints } from './machine'
import { useTour } from './store'
import { loadWaypoints } from './waypoints'

export type ActionId = 'clear-sol' | 'storm-sol' | 'play-day' | 'open-scorecard' | 'toggle-panel'

export interface Step {
  id: string
  title: string
  /** one or two sentences, plain English */
  body: string
  /** short honest qualifiers shown under the body */
  notes?: string[]
  actions?: Array<{ id: ActionId; label: string }>
  /** puts the app in this step's deterministic state; `isCurrent` turns false when the user moved on */
  enter: (isCurrent: () => boolean) => Promise<void>
}

export const SCENARIO = {
  clear: 'jezero-v1/l2/solar-clear', // sol 148, tau 0.5
  storm: 'jezero-v1/l2/solar-storm', // sol 315, tau 2.0
  astronaut: 'jezero-v1/l2/astronaut-clear',
  onesol: 'jezero-v1/l3/rtg-onesol',
} as const

/** Science stop of the Marswalk: the high-confidence Mg-carbonate patch (CRISM, ML-derived), id from the Mission panel */
export const SCIENCE_STOP = 'mineral-mg-carbonate-patch'

export const EXAMPLE_RUN_FILE = 'example.run.json'

export const isPhone = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches

function show(mode: Mode) {
  const app = useApp.getState()
  app.setMode(mode)
  app.setSheetExpanded(false) // mobile: peek, so the 3D view and the card stay visible
}

/** Common base state so every step starts from the same place whatever the user touched before. */
function base() {
  const app = useApp.getState()
  app.setLayer('none')
  app.setShowTraverse(false)
  useDay.getState().setPlaying(false)
  if (useCamera.getState().mode !== 'orbit') useCamera.getState().setMode('orbit')
}

async function frameWaypoints(pad: number, subset?: Array<{ x: number; z: number }>) {
  const ds = useApp.getState().dataset
  if (!ds) return
  const pts = subset ?? (await loadWaypoints(ds).catch(() => []))
  if (pts.length === 0) return
  focusBounds({
    minX: Math.min(...pts.map((p) => p.x)) - pad,
    maxX: Math.max(...pts.map((p) => p.x)) + pad,
    minZ: Math.min(...pts.map((p) => p.z)) - pad,
    maxZ: Math.max(...pts.map((p) => p.z)) + pad,
  })
}

/** Fetches the published example run (same-origin) and hands it to the AI Lab like a dropped file. */
export async function loadExampleRun(): Promise<'ok' | 'missing'> {
  const ds = useApp.getState().dataset
  if (!ds) return 'missing'
  const byo = useByo.getState()
  if (byo.run.fileName === EXAMPLE_RUN_FILE && (byo.run.session || byo.run.loading)) return 'ok'
  try {
    const res = await fetch(`${ds.base}/baselines/${EXAMPLE_RUN_FILE}`)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return 'missing'
    const blob = await res.blob()
    useByo.getState().actions.loadRun(new File([blob], EXAMPLE_RUN_FILE, { type: 'application/json' }))
    return 'ok'
  } catch {
    return 'missing'
  }
}

export const STEPS: readonly Step[] = [
  {
    id: 'terrain',
    title: 'Real Jezero terrain',
    body: 'This is the Perseverance landing region, built from the 1 m HiRISE elevation model. The Validation card checks it against what the rover itself measured.',
    notes: ['Height at the rover waypoints matches its own elevations (r = 0.99999).', 'The real traverse was planned by humans: a reference, not ground truth.'],
    enter: async (cur) => {
      base()
      useApp.getState().setShowTraverse(true)
      show('data')
      useApp.getState().setSheetExpanded(false)
      await scrollInspectorTo('Validation')
      if (cur()) await frameWaypoints(120)
    },
  },
  {
    id: 'conditions',
    title: 'Mars conditions',
    body: 'Pick a real sol from the rover’s weather station. A clear sol and a dust storm change the sky, and the Sun follows the Mars24 model, so shadows move with local time.',
    notes: ['Every value in Current conditions carries a chip: measured, derived, modeled or assumption.'],
    actions: [
      { id: 'clear-sol', label: 'Clear sol 148' },
      { id: 'storm-sol', label: 'Dust storm sol 315' },
      { id: 'play-day', label: 'Play the day' },
    ],
    enter: async (cur) => {
      base()
      useScenario.getState().selectScenario(SCENARIO.clear)
      show('explore')
      await scrollInspectorTo('Time and sky')
      if (cur()) useCamera.getState().setMode('orbit')
    },
  },
  {
    id: 'marswalk',
    title: 'Marswalk',
    body: 'The astronaut profile walks to a science stop, the Mg-carbonate patch seen from orbit, under its own slope limit. The Mission panel shows the route, the walk budget and the shelter rule for a solar particle alert.',
    notes: ['Limits are team assumptions, labelled as such. A training rule, not a forecast.'],
    actions: [{ id: 'toggle-panel', label: 'Walk budget' }],
    enter: async (cur) => {
      base()
      useScenario.getState().selectScenario(SCENARIO.astronaut)
      show('mission')
      const ds = useApp.getState().dataset
      if (!ds) return
      const wps = await loadWaypoints(ds).catch(() => [])
      const pair = pickWaypoints(wps)
      if (!cur() || !pair) return
      setMissionProfile('astronaut')
      useMission.getState().clear()
      // the shelter is a real rover waypoint; the stop is the Mg-carbonate patch (CRISM), or a waypoint if the patch is unavailable
      useMission.setState({ origin: { x: pair.origin.x, z: pair.origin.z } })
      if (!(await selectScienceTarget(SCIENCE_STOP))) {
        await setMissionEndpoints({ x: pair.origin.x, z: pair.origin.z }, { x: pair.destination.x, z: pair.destination.z })
        if (cur()) await frameWaypoints(80, [pair.origin, pair.destination])
      }
      await waitFor(() => (useMission.getState().planning ? null : Object.keys(useMission.getState().outcomes).length > 0 || null), 8000)
      if (!cur()) return
      // the traverse diamonds helped to pick the stop; now the astronaut route is what matters, so the real traverse steps back
      useApp.getState().setShowTraverse(false)
      if (isPhone()) useApp.getState().setInspectorOpen(false) // phone: the route first, the numbers one tap away
      else await scrollInspectorTo('EVA budget')
    },
  },
  {
    id: 'rover',
    title: 'Rover: one plan per sol',
    body: 'A radio signal needs minutes to cross between Earth and Mars, so the rover gets one plan per sol and nobody can correct it mid-day. That is why it needs autonomy.',
    notes: ['An operations constraint: one plan per sol, with the light-time of the chosen date shown in Current conditions.'],
    enter: async (cur) => {
      base()
      useScenario.getState().selectScenario(SCENARIO.onesol)
      setMissionProfile('rover-rtg')
      show('explore')
      await scrollInspectorTo('Current conditions')
      if (cur()) useCamera.getState().setMode('orbit')
    },
  },
  {
    id: 'byo',
    title: 'Bring your own AI',
    body: 'Drop in your model’s run.json or an ONNX policy: it runs in your browser and nothing is uploaded. Here an example run is loaded. MARS-X re-simulates every episode itself and builds the scorecard.',
    notes: ['Even the oracle planner fails L2: conditions matter.', 'The scorecard shows levels with 95% Wilson intervals, anything Not verifiable, and the baselines.'],
    actions: [{ id: 'open-scorecard', label: 'Open scorecard' }],
    enter: async (cur) => {
      base()
      show('lab')
      await clickByRole('radio', 'Bring your model')
      if (cur()) useTour.setState({ exampleMissing: (await loadExampleRun()) === 'missing' })
      if (cur()) await scrollInspectorTo('Benchmark run')
    },
  },
  {
    id: 'graduate',
    title: 'Graduate to a full simulator',
    body: 'Export the exact scenario, terrain included, to Gazebo or Isaac Sim and go further with your model.',
    notes: [
      'Gazebo: SDF checked against template rules, not run in Gazebo. Isaac Sim: not tested (OBJ for the MeshConverter).',
      'MARS-X is a first filter: necessary, not sufficient.',
    ],
    enter: async () => {
      base()
      show('data')
      await scrollInspectorTo('Export to Gazebo')
    },
  },
]
