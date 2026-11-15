import { Fragment, useEffect, useRef, useState } from 'react'
import { useApp } from '@/store/app'
import { useCamera } from '@/store/camera'
import { usePlayback } from '@/store/playback'
import { bumpCount, hintFor, HINT_MS, readCounts, shouldShow, writeCounts } from './hints'
import { useNav } from './store'

const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, i) =>
        part.startsWith('[') ? (
          <kbd key={i} className="keycap mx-0.5 align-middle">
            {part.slice(1, -1)}
          </kbd>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * One line above the dock with the controls of the current camera. Shows on each camera change for 6 s, at most 3 times per
 * camera per browser (localStorage, try/catch), and again whenever a dock button or the dock "?" is pressed.
 */
export function ControlHints() {
  const mode = useCamera((s) => s.mode)
  const ready = useApp((s) => s.progress.ready >= 1)
  const nonce = useNav((s) => s.hintNonce)
  const notice = useNav((s) => s.notice)
  const watching = usePlayback((s) => s.source !== null)
  // the first-visit card already explains these controls: hold the hint back (and do not use up one of its three showings)
  const onboarding = useApp((s) => s.onboardingOpen)
  const sheetUp = useApp((s) => s.inspectorOpen && s.sheetSnap !== 'peek')
  const [shown, setShown] = useState(false)
  const seen = useRef(0)

  useEffect(() => {
    if (!ready || onboarding) return
    const forced = nonce !== seen.current
    seen.current = nonce
    const counts = readCounts()
    if (!forced && !shouldShow(counts, mode)) return
    if (!forced) writeCounts(bumpCount(counts, mode))
    setShown(true)
    const t = setTimeout(() => setShown(false), HINT_MS)
    return () => clearTimeout(t)
  }, [mode, nonce, ready, onboarding])

  // phones: with the sheet raised there is no room for a hint
  if (onboarding || watching || (sheetUp && !window.matchMedia('(min-width: 768px)').matches)) return null
  const text = notice ?? (shown ? hintFor(mode, isTouch()) : null)
  if (!text) return null
  return (
    <p role="status" className="glass pointer-events-none flex min-h-8 max-w-[calc(100vw-1.5rem)] items-center rounded-full px-3.5 py-1 text-center text-xs text-foreground [@media(prefers-reduced-motion:no-preference)]:animate-in [@media(prefers-reduced-motion:no-preference)]:fade-in">
      <Rich text={text} />
    </p>
  )
}
