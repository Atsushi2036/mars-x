import { create } from 'zustand'

/** UI state of the map widgets (help dialog, short notices, hint re-show requests). */
export const useNav = create<{ helpOpen: boolean; notice: string | null; hintNonce: number }>(() => ({ helpOpen: false, notice: null, hintNonce: 0 }))

export const openHelp = () => useNav.setState({ helpOpen: true })
export const setHelpOpen = (helpOpen: boolean) => useNav.setState({ helpOpen })
/** Re-shows the control hint of the current camera (dock "?" button). */
export const replayHints = () => useNav.setState((s) => ({ hintNonce: s.hintNonce + 1 }))

let noticeTimer: ReturnType<typeof setTimeout> | undefined
/** One short line above the dock for a couple of seconds ("Switch to Orbit to move the view"). */
export function flashNotice(text: string, ms = 2600): void {
  useNav.setState({ notice: text })
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => useNav.setState({ notice: null }), ms)
}
