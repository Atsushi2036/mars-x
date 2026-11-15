import { Compass, Info, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { startGuidedMission } from '@/features/guided/api'
import { useApp } from '@/store/app'

const KEY = 'marsx.onboarded'
const AUTO_CLOSE_MS = 10_000

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
function remember() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* storage can be blocked */
  }
}

/** First-visit tip card: appears once the scene is ready, closes itself after 10 s, reopened from the "?" button. */
export function Onboarding() {
  const open = useApp((s) => s.onboardingOpen)
  const ready = useApp((s) => s.progress.ready >= 1)
  const setOpen = useApp((s) => s.setOnboardingOpen)
  const hover = useRef(false)

  useEffect(() => {
    if (ready && !seen()) setOpen(true)
  }, [ready, setOpen])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      if (!hover.current) {
        setOpen(false)
        remember()
      }
    }, AUTO_CLOSE_MS)
    return () => clearTimeout(t)
  }, [open, setOpen])

  if (!open) return null
  const close = () => {
    setOpen(false)
    remember()
  }
  return (
    <section
      aria-label="Quick tour"
      // only a real mouse hover pauses the auto-close: on touch there is no pointerleave, so it would never close
      onPointerEnter={(e) => (hover.current = e.pointerType === 'mouse')}
      onPointerLeave={() => (hover.current = false)}
      className="pointer-events-auto absolute left-3 right-3 top-[3.75rem] z-30 rounded-xl border border-border bg-card/95 p-2.5 text-card-foreground md:p-4 shadow-lg backdrop-blur-md md:left-1/2 md:right-auto md:w-[26rem] md:-translate-x-1/2"
    >
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-[13px] font-semibold leading-5 md:text-sm">Real terrain from Jezero crater, Mars</h2>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
            <li>Drag to orbit and scroll or pinch to zoom. Keys 1, 2 and 3 switch the camera.</li>
            <li className="hidden md:list-item">Open Mission, then click the terrain to set an origin and a destination.</li>
            <li className="hidden md:list-item">Sources and the NASA/JPL/Caltech disclaimer are in Data &amp; Sources.</li>
          </ul>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              close()
              startGuidedMission()
            }}
          >
            <Compass aria-hidden="true" />
            Guided mission
          </Button>
        </div>
        <Button variant="ghost" size="icon" aria-label="Dismiss tips" className="-mr-1.5 -mt-1.5 size-9 md:size-7" onClick={close}>
          <X />
        </Button>
      </div>
    </section>
  )
}
