import { useSyncExternalStore } from 'react'

const Q = '(prefers-reduced-motion: reduce)'

/** True when the user asked for less motion; updates live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(Q)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(Q).matches,
    () => false,
  )
}
