import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useTour } from '@/features/guided/store'
import { fmtDeg, fmtInt } from '@/lib/format'
import { useMission } from '@/store/mission'

const ID = 'route-result'

/**
 * Planning feedback as toasts: "Route ready · 554 m · max slope 18.5°" (information only: the Watch button lives in the camera dock), or a plain "No safe route".
 * Fires once per finished plan (a plan replaces the whole `outcomes` object). Silent during the guided tour, which has its own card.
 * Also hosts the shared Toaster.
 */
export function RouteToasts() {
  useEffect(() => {
    let last = useMission.getState().outcomes
    return useMission.subscribe((s) => {
      if (s.outcomes === last) return
      last = s.outcomes
      const out = s.outcomes[s.profile]
      if (!out || s.planning || useTour.getState().active) return
      if (out.status === 'ok') {
        toast.success(`Route ready · ${fmtInt(out.stats.lengthM)} m · max ${fmtDeg(out.stats.maxSlopeDeg)}`, {
          id: ID,
          duration: 4000,
        })
      } else if (out.status === 'no-route') {
        toast.warning('No safe route between these two points', {
          id: ID,
          description: 'Move the goal or pick a profile with a higher slope limit.',
          duration: 7000,
        })
      } else toast.error('Planning failed', { id: ID, description: out.message, duration: 7000 })
    })
  }, [])
  return <Toaster />
}
