import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const ScenarioPanel = lazy(() => import('./ScenarioPanel').then((m) => ({ default: m.ScenarioPanel })))

// Conditions, time, scenario and the camera tools form the Explore panel (replaces the built-in body, which stays as fallback).
registerSlot({ id: 'scenario.panel', slot: 'panel:explore', mode: 'replace', order: 50, component: ScenarioPanel })
