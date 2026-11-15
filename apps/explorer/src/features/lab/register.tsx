import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const LabPanel = lazy(() => import('./LabPanel').then((m) => ({ default: m.LabPanel })))
const Host = lazy(() => import('./Host'))
const TrainGhost = lazy(() => import('./TrainGhost'))

registerSlot({ id: 'lab.panel', slot: 'panel:lab', mode: 'replace', component: LabPanel })
// headless: keeps the ONNX and run.json Workers alive while the user switches inspector modes
registerSlot({ id: 'lab.host', slot: 'overlay', component: Host })
// the ghost rover that replays the last training episode over the real terrain (only draws when "Show in 3D" is on)
registerSlot({ id: 'lab.train-ghost', slot: 'scene', component: TrainGhost })
