import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const ExportPanel = lazy(() => import('./ExportPanel').then((m) => ({ default: m.ExportPanel })))

// appended to the "Data & Sources" inspector, after the dataset facts
registerSlot({ id: 'export.panel', slot: 'panel:data', order: 200, component: ExportPanel })
