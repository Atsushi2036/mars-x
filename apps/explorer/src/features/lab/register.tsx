import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const LabPanel = lazy(() => import('./LabPanel').then((m) => ({ default: m.LabPanel })))
const Host = lazy(() => import('./Host'))

registerSlot({ id: 'lab.panel', slot: 'panel:lab', mode: 'replace', component: LabPanel })
// headless: keeps the ONNX and run.json Workers alive while the user switches inspector modes
registerSlot({ id: 'lab.host', slot: 'overlay', component: Host })
