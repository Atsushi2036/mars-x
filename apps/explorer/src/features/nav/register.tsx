import { lazy } from 'react'
import { registerSlot } from '@/ui/slots'

// 3D navigation widgets (camera dock, zoom cluster + compass, minimap, Watch bar, hints, help): UX package B
registerSlot({ id: 'nav.layer', slot: 'overlay', order: 50, component: lazy(() => import('@/ui/nav/NavLayer')) })
