import { Hand, Keyboard, MousePointerClick, Sparkles, X, type LucideIcon } from '@/ui/icons'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { startGuidedMission } from '@/features/guided/api'
import { useApp } from '@/store/app'

const KEY = 'marsx.onboarded'
const AUTO_CLOSE_MS = 12_000

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

const ROWS: { icon: LucideIcon; text: string; desktopOnly?: boolean }[] = [
  { icon: Hand, text: 'Drag to look around' },
  { icon: MousePointerClick, text: 'Double-click to fly' },
  { icon: Keyboard, text: '1 2 3 change camera', desktopOnly: true },
]

/**
 * First-visit hint: three icon rows of a few words, one primary action. Sits above the bottom chrome (never over the
 * horizon), closes itself after 12 s or on the first touch of the scene, and reopens from the "?" button.
 */
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
    // the first drag or click on the 3D view dismisses it
    const scene = document.querySelector('#scene canvas')
    const onScene = () => {
      setOpen(false)
      remember()
    }
    scene?.addEventListener('pointerdown', onScene, { once: true })
    return () => {
      clearTimeout(t)
      scene?.removeEventListener('pointerdown', onScene)
    }
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
      className="glass pointer-events-auto absolute bottom-[calc(var(--cover-bottom)+5.5rem)] left-3 z-30 w-[19rem] rounded-2xl p-4 text-card-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 md:bottom-[calc(var(--cover-bottom)+6.5rem)] md:left-1/2 md:w-80 md:-translate-x-1/2"
    >
      <Button variant="ghost" size="icon" aria-label="Dismiss tips" className="absolute right-1.5 top-1.5 size-9 [&_svg]:size-5" onClick={close}>
        <X />
      </Button>
      <ul className="space-y-2.5 pr-8">
        {ROWS.map((r) => (
          <li key={r.text} className={`items-center gap-3 text-base font-medium ${r.desktopOnly ? 'hidden md:flex' : 'flex'}`}>
            <r.icon className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
            {r.text}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2">
        <Button
          className="h-11 flex-1 gap-2 text-base"
          onClick={() => {
            close()
            startGuidedMission()
          }}
        >
          <Sparkles className="size-5" aria-hidden="true" />
          Start tour
        </Button>
        <Button variant="ghost" className="h-11 px-4 text-base" onClick={close}>
          Skip
        </Button>
      </div>
    </section>
  )
}
