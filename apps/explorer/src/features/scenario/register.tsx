import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const ScenarioPanel = lazy(() => import('./ScenarioPanel').then((m) => ({ default: m.ScenarioPanel })))

// Scenario and conditions live in the Explore inspector, after the built-in camera controls.
registerSlot({ id: 'scenario.panel', slot: 'panel:explore', mode: 'append', order: 50, component: ScenarioPanel })
