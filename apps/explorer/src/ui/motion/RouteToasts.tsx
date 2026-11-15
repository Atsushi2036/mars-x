import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useTour } from '@/features/guided/store'
import { fmtDeg, fmtInt } from '@/lib/format'
import { useMission } from '@/store/mission'
import { useWizard } from './../wizard/store'
import { usePlayback } from '@/store/playback'

const ID = 'route-result'

/**
 * Planning feedback as toasts: "Route ready · 554 m · max slope 18.5°" (information only: the Watch button lives in the camera dock), or a plain "No safe route".
 * Fires once per finished plan (a plan replaces the whole `outcomes` object). Silent during the guided tour, which has its own card.
 * Also hosts the shared Toaster.
 */
export function RouteToasts() {
  useEffect(() => {
    let last = useMission.getState().outcomes
    let lastNotice = useMission.getState().placeNotice
    return useMission.subscribe((s) => {
      // a goal that is too close to the start (outside the wizard, whose banner says it)
      if (s.placeNotice !== lastNotice) {
        lastNotice = s.placeNotice
        if (s.placeNotice && !useWizard.getState().active) toast.warning(s.placeNotice, { id: 'place-notice', duration: 3500 })
      }
      if (s.outcomes === last) return
      last = s.outcomes
      const out = s.outcomes[s.profile]
      if (!out || s.planning || useTour.getState().active || useWizard.getState().active || usePlayback.getState().source === 'route') return
      if (out.status === 'ok' && out.stats.lengthM >= 1) {
        toast.success(`Route ready · ${fmtInt(out.stats.lengthM)} m · max ${fmtDeg(out.stats.maxSlopeDeg)}`, {
          id: ID,
          duration: 4000,
        })
      } else if (out.status === 'no-route' || out.status === 'ok') {
        toast.warning('No safe route between these two points', {
          id: ID,
          description: 'Move the goal or pick a profile with a higher slope limit.',
          duration: 7000,
        })
      } else toast.error('Planning failed', { id: ID, description: out.message, duration: 7000 })
    })
  }, [])
  const immersive = usePlayback((s) => s.source === 'route')
  return immersive ? null : <Toaster />
}
