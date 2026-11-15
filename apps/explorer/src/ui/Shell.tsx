import { useRef, type ReactNode } from 'react'
import { Inspector } from './Inspector'
import { Joystick } from './Joystick'
import { Onboarding } from './Onboarding'
import { ModeRail } from './ModeRail'
import { TelemetryBar } from './TelemetryBar'
import { Slot } from './slots'
import { Topbar } from './Topbar'
import { useCoverVars } from './cover'

/**
 * Mission-control shell: labelled dark rail, full-bleed canvas, glass topbar and inspector, telemetry strip.
 * `children` is the 3D scene, rendered edge to edge underneath the chrome. `#scene` publishes `--cover-*`
 * (see ./cover.ts) so every floating widget keeps clear of the chrome.
 * Z order: scene 0, map widgets 10, topbar/telemetry/inspector 20, toasts 40, dialogs 50.
 */
export function Shell({ children }: { children: ReactNode }) {
  const scene = useRef<HTMLElement>(null)
  useCoverVars(scene)
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <a
        href="#scene"
        className="sr-only z-50 rounded-lg bg-card px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-24 focus:top-2"
      >
        Skip to the 3D view
      </a>
      <ModeRail />
      <main ref={scene} id="scene" className="relative min-w-0 flex-1" aria-label="Terrain view">
        {children}
        <Topbar />
        <Onboarding />
        <Slot name="overlay" />
        <Inspector />
        <Joystick />
        <TelemetryBar />
      </main>
    </div>
  )
}
