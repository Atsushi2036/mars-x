import { Compass, Database, FlaskConical, Layers, Route, type LucideIcon } from 'lucide-react'
import type { Mode } from '@/store/app'

export interface ModeDef {
  id: Mode
  label: string
  icon: LucideIcon
  /** one-line description shown in the inspector header */
  blurb: string
}

export const MODES: ModeDef[] = [
  { id: 'explore', label: 'Explore', icon: Compass, blurb: 'Fly, walk and follow the rover over the terrain.' },
  { id: 'layers', label: 'Layers', icon: Layers, blurb: 'Overlay derived and scientific data on the surface.' },
  { id: 'mission', label: 'Mission', icon: Route, blurb: 'Plan and run routes for the rover or an astronaut.' },
  { id: 'lab', label: 'AI Lab', icon: FlaskConical, blurb: 'Bring your own navigation model and test it.' },
  { id: 'data', label: 'Data & Sources', icon: Database, blurb: 'What is on screen, where it comes from, how it was made.' },
]
