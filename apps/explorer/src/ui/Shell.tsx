import type { ReactNode } from 'react'
import { Inspector } from './Inspector'
import { Joystick } from './Joystick'
import { Onboarding } from './Onboarding'
import { ModeRail } from './ModeRail'
import { TelemetryBar } from './TelemetryBar'
import { Slot } from './slots'
import { Topbar } from './Topbar'

/**
 * Mission-control shell (UX direction A): dark mode rail, full-bleed canvas, floating inspector,
 * telemetry strip. `children` is the 3D scene, rendered edge to edge underneath the chrome.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <a
        href="#scene"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-16 focus:top-2"
      >
        Skip to the 3D view
      </a>
      <ModeRail />
      <main id="scene" className="relative min-w-0 flex-1" aria-label="Terrain view">
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
