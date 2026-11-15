import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { roverLive, useRover } from '@/store/rover'
import { RoverIcon, Square } from '../icons'
import { Details, PanelSection } from '../kit'
import { SunOverride } from './SunSection'

/** Demo loop around the rover; NOT a planned route (planning lives in "Plan a route"). */
function demoLoop(hf: NonNullable<ReturnType<typeof useApp.getState>['dataset']>['heightfield']) {
  const cx = roverLive.x
  const cz = roverLive.z
  const r = 45
  const pts = []
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const x = Math.max(hf.extent.xMin + 20, Math.min(hf.extent.xMax - 20, cx + Math.cos(a) * r - r))
    const z = Math.max(hf.extent.zMin + 20, Math.min(hf.extent.zMax - 20, cz + Math.sin(a) * r))
    pts.push({ x, z })
  }
  return pts
}

/** Rover demo and the manual sun. The camera choice lives in the always-visible camera dock, not here. */
export function ExploreTools() {
  const ds = useApp((s) => s.dataset)
  const status = useRover((s) => s.status)
  const follow = useRover((s) => s.followPath)
  const stop = useRover((s) => s.stop)

  return (
    <>
      <PanelSection title="Rover" caption="A short loop that shows the rover following the ground.">
        {status === 'driving' ? (
          <Button variant="secondary" className="h-11 w-full gap-2" onClick={stop}>
            <Square className="size-5" strokeWidth={1.75} /> Stop rover
          </Button>
        ) : (
          <Button variant="secondary" className="h-11 w-full gap-2" disabled={!ds} onClick={() => ds && follow(demoLoop(ds.heightfield), 2, true)}>
            <RoverIcon className="size-6" strokeWidth={1.75} /> Drive demo loop
          </Button>
        )}
      </PanelSection>
      <PanelSection>
        <Details summary="Sun and shadows">
          <SunOverride />
        </Details>
      </PanelSection>
    </>
  )
}

/** Built-in Explore body (shown until the scenario module replaces it with the full panel). */
export function ExplorePanel() {
  return (
    <div>
      <ExploreTools />
    </div>
  )
}
