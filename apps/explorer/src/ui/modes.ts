import { Compass, Database, FlaskConical, Layers, Route, type LucideIcon } from '@/ui/icons'
import type { Mode } from '@/store/app'

export interface ModeDef {
  id: Mode
  /** task name shown on the rail (desktop) and as the panel title */
  label: string
  /** shorter name for the phone bottom bar */
  shortLabel: string
  icon: LucideIcon
  /** panel title */
  title: string
  /** one line (<= 60 characters) under the panel title */
  subtitle: string
  /** false = reachable from the map, not from the rail (Layers highlights Explore) */
  rail: boolean
}

export const SUBTITLE_MAX = 60

export const MODES: ModeDef[] = [
  { id: 'explore', label: 'Explore', shortLabel: 'Explore', icon: Compass, title: 'Explore Jezero', subtitle: 'Look around, set the sol and time.', rail: true },
  { id: 'layers', label: 'Layers', shortLabel: 'Layers', icon: Layers, title: 'Layers', subtitle: 'Paint slope, hazard and minerals on the terrain.', rail: false },
  { id: 'mission', label: 'Plan a route', shortLabel: 'Plan', icon: Route, title: 'Plan a route', subtitle: 'Pick a start and a goal, we find a safe path.', rail: true },
  { id: 'lab', label: 'Test your AI', shortLabel: 'Test AI', icon: FlaskConical, title: 'Test your AI', subtitle: 'Train in the browser or drop your own model.', rail: true },
  { id: 'data', label: 'Data', shortLabel: 'Data', icon: Database, title: 'Data', subtitle: 'Where the terrain and conditions come from.', rail: true },
]

export const RAIL_MODES = MODES.filter((m) => m.rail)

/** The rail item that is lit for a mode (Layers lives under Explore). */
export function railIdFor(mode: Mode): Mode {
  return mode === 'layers' ? 'explore' : mode
}
