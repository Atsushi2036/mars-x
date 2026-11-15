import { usePlayback } from '@/store/playback'
import { useWizard } from './store'

/**
 * Immersive mode: while a planned route is being watched (from the dock button, the wizard or the tour) only the agent,
 * the playback bar and Exit remain. Rail, sheet or inspector, minimap, zoom, toasts and hints step aside, and come back
 * by themselves when the Watch ends (their own state was never touched).
 */
export function useImmersive(): boolean {
  const journey = useWizard((s) => s.journey)
  const routeWatch = usePlayback((s) => s.source === 'route')
  return journey || routeWatch
}
