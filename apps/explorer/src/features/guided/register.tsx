import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

const GuidedCard = lazy(() => import('./GuidedCard'))
const GuidedButton = lazy(() => import('./GuidedButton'))

registerSlot({ id: 'guided.button', slot: 'topbar:right', order: 10, component: GuidedButton })
registerSlot({ id: 'guided.card', slot: 'overlay', order: 300, component: GuidedCard })
