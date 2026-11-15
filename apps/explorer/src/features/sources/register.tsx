import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const SourcesPanel = lazy(() => import('./SourcesPanel').then((m) => ({ default: m.SourcesPanel })))

// replaces the built-in Data panel: dataset facts, validation, credits from the manifest, scope and AI use
registerSlot({ id: 'sources.panel', slot: 'panel:data', mode: 'replace', component: SourcesPanel })
