import { startRouteWatch } from '@/store/watch'

/**
 * The one place the wizard starts the journey from. Today it starts the route Watch; when the playback owner exposes
 * `startJourney()` in store/playback, only this function changes.
 */
export function beginJourney(): boolean {
  return startRouteWatch()
}
