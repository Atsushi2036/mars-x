import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const ReplayLayer = lazy(() => import('./ReplayLayer'))

// the replayed trajectory is drawn inside the 3D canvas; the controls live in the AI Lab panel (features/lab)
registerSlot({ id: 'replay.layer', slot: 'scene', component: ReplayLayer })
