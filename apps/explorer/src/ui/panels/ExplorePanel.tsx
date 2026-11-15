import { Bot, Footprints, Orbit, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useApp } from '@/store/app'
import { useCamera, type CameraMode } from '@/store/camera'
import { roverLive, useRover } from '@/store/rover'
import { Section } from './Section'
import { SunSection } from './SunSection'

const HINTS: Record<CameraMode, string> = {
  orbit: 'Drag to orbit, right-drag or two fingers to pan, wheel or pinch to zoom.',
  fpv: 'W A S D to move, Shift to sprint. Click the view to capture the mouse, Esc releases it. On touch: left stick moves, drag to look.',
  chase: 'The camera follows the rover from behind.',
}

/** Demo loop around the rover; NOT a planned route (planning arrives with the Mission mode). */
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

export function ExplorePanel() {
  const camMode = useCamera((s) => s.mode)
  const setCam = useCamera((s) => s.setMode)
  const ds = useApp((s) => s.dataset)
  const status = useRover((s) => s.status)
  const follow = useRover((s) => s.followPath)
  const stop = useRover((s) => s.stop)

  return (
    <div>
      <Section title="Camera" hint={HINTS[camMode]}>
        <ToggleGroup
          type="single"
          value={camMode}
          onValueChange={(v) => v && setCam(v as CameraMode)}
          variant="outline"
          spacing={0}
          className="w-full"
          aria-label="Camera mode"
        >
          <ToggleGroupItem value="orbit" className="h-10 flex-1 gap-1.5 md:h-8" aria-label="Orbit camera (1)">
            <Orbit /> Orbit
          </ToggleGroupItem>
          <ToggleGroupItem value="fpv" className="h-10 flex-1 gap-1.5 md:h-8" aria-label="First-person camera (2)">
            <Footprints /> Walk
          </ToggleGroupItem>
          <ToggleGroupItem value="chase" className="h-10 flex-1 gap-1.5 md:h-8" aria-label="Follow rover camera (3)">
            <Bot /> Rover
          </ToggleGroupItem>
        </ToggleGroup>
      </Section>

      <Section title="Rover" hint="Perseverance 3D model (NASA/JPL-Caltech). The demo loop shows terrain-following; plan real routes in Mission.">
        {status === 'driving' ? (
          <Button variant="secondary" className="h-10 w-full md:h-8" onClick={stop}>
            <Square /> Stop rover
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="h-10 w-full md:h-8"
            disabled={!ds}
            onClick={() => ds && follow(demoLoop(ds.heightfield), 2, true)}
          >
            <Bot /> Drive demo loop
          </Button>
        )}
      </Section>

      <SunSection />
    </div>
  )
}
