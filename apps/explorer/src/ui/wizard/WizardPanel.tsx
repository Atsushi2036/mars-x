import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PROFILES } from '@/intelligence/nav/profiles'
import { fmtInt } from '@/lib/format'
import { useApp } from '@/store/app'
import { useMission, type MissionProfile } from '@/store/mission'
import { ROVER_REAL_SPEED } from '@/store/watch'
import { beginJourney } from './journey'
import { DriverPicker } from '../nav/DriverPicker'
import { setDriveMode, useDriver, GUIDED_SPACING_M, type DriveMode } from '@/store/driver'
import { AstronautIcon, CircleAlert, Flag, Play, Route, RoverIcon, type LucideIcon } from '../icons'
import { Segmented, StatCard } from '../kit'
import { MarswalkSetup } from '../panels/MarswalkPanel'
import { WizardStepper } from './PlanWizard'
import { driverSummary, missionTimeParts } from './machine'
import { useWizard } from './store'

const PROFILE_LABEL: Record<MissionProfile, string> = { astronaut: 'Astronaut', 'rover-rtg': 'Rover RTG', 'rover-solar': 'Rover solar' }
const PROFILE_ICON: Record<MissionProfile, LucideIcon> = { astronaut: AstronautIcon, 'rover-rtg': RoverIcon, 'rover-solar': RoverIcon }

/** Sticky bottom bar with the step's actions (the scroll hint pill keeps clear of a `.sticky.bottom-0` bar). */
function Actions({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur max-md:px-3.5">{children}</div>
}

function useOutcome() {
  const profile = useMission((s) => s.profile)
  const outcome = useMission((s) => s.outcomes[s.profile])
  const planning = useMission((s) => s.planning)
  const both = useMission((s) => !!s.origin && !!s.destination)
  return { profile, outcome, planning, both }
}

function Who() {
  const profile = useMission((s) => s.profile)
  const setProfile = useMission((s) => s.setProfile)
  const limit = useMission((s) => s.astronautSlopeLimit)
  const dispatch = useWizard((s) => s.dispatch)
  return (
    <>
      <div className="space-y-4 px-4 py-4 max-md:px-3.5">
        <Segmented<MissionProfile>
          label="Traverse profile"
          stacked
          value={profile}
          onChange={setProfile}
          options={(Object.keys(PROFILE_LABEL) as MissionProfile[]).map((id) => ({
            value: id,
            label: PROFILE_LABEL[id],
            icon: PROFILE_ICON[id],
            sub: `Limit ${id === 'astronaut' ? limit : PROFILES[id].maxSlope}°`,
          }))}
        />
      </div>
      <Actions>
        <Button variant="outline" className="h-12 flex-1" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
        <Button className="h-12 flex-[2] text-base" onClick={() => dispatch({ type: 'next' })}>
          Continue
        </Button>
      </Actions>
    </>
  )
}

function Driver() {
  const dispatch = useWizard((s) => s.dispatch)
  return (
    <>
      <div className="space-y-3 px-4 py-4 max-md:px-3.5">
        <p className="text-lg font-semibold">Who drives?</p>
        <DriverPicker part="drivers" />
      </div>
      <Actions>
        <Button variant="outline" className="h-12 flex-1" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
        <Button className="h-12 flex-[2] text-base" onClick={() => dispatch({ type: 'next' })}>
          Continue
        </Button>
      </Actions>
    </>
  )
}

/** Only for an AI driver: follow the planned waypoints, or find its own way to the goal. */
function How() {
  const dispatch = useWizard((s) => s.dispatch)
  const mode = useDriver((s) => s.mode)
  return (
    <>
      <div className="space-y-3 px-4 py-4 max-md:px-3.5">
        <p className="text-lg font-semibold">How does it drive?</p>
        <Segmented<DriveMode>
          label="How the AI drives"
          columns={2}
          value={mode}
          onChange={setDriveMode}
          options={[
            { value: 'guided', label: 'Guided', sub: `Follows the planned route's waypoints (every ~${GUIDED_SPACING_M} m)`, icon: Route },
            { value: 'free', label: 'Free', sub: 'You only set the goal; the AI finds its own way', icon: Flag },
          ]}
        />
      </div>
      <Actions>
        <Button variant="outline" className="h-12 flex-1" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
        <Button className="h-12 flex-[2] text-base" onClick={() => dispatch({ type: 'next' })}>
          Continue
        </Button>
      </Actions>
    </>
  )
}

function Options() {
  const dispatch = useWizard((s) => s.dispatch)
  return (
    <>
      <div className="px-4 pt-4 max-md:px-3.5">
        <h3 className="text-lg font-semibold">Options</h3>
        <p className="text-sm text-muted-foreground">Optional. The defaults are already set.</p>
      </div>
      <MarswalkSetup />
      <Actions>
        <Button variant="outline" className="h-12 flex-1" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
        <Button variant="ghost" className="h-12 flex-1" onClick={() => dispatch({ type: 'skip' })}>
          Skip
        </Button>
        <Button className="h-12 flex-[1.4] text-base" onClick={() => dispatch({ type: 'next' })}>
          Continue
        </Button>
      </Actions>
    </>
  )
}

function Review() {
  const dispatch = useWizard((s) => s.dispatch)
  const { profile, outcome, planning, both } = useOutcome()
  const walkSpeed = useMission((s) => s.walk.speedMs)
  const limit = useMission((s) => (s.profile === 'astronaut' ? s.astronautSlopeLimit : PROFILES[s.profile].maxSlope))
  const ok = outcome?.status === 'ok' && outcome.stats.lengthM >= 1 ? outcome : null
  // mission time is the real one (distance over the real speed), not the sped-up playback
  const speed = profile === 'astronaut' ? walkSpeed : ROVER_REAL_SPEED
  const missionTime = missionTimeParts(ok ? ok.stats.lengthM / speed : 0)
  const driverKind = useDriver((s) => s.kind)
  const driveMode = useDriver((s) => s.mode)
  const catalog = useDriver((s) => s.catalog)
  const summary = driverSummary(driverKind, driveMode, PROFILE_LABEL[profile], catalog)
  const go = () => {
    if (!ok || !beginJourney()) return
    dispatch({ type: 'go' })
    useApp.getState().setInspectorOpen(false)
  }
  return (
    <>
      <div className="space-y-4 px-4 py-4 max-md:px-3.5">
        {planning && !outcome && both && (
          <div className="grid grid-cols-3 gap-2" role="status" aria-label="Planning">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        )}
        {ok && (
          <div className="grid grid-cols-3 gap-2">
            <StatCard compact label="Distance" value={fmtInt(ok.stats.lengthM)} unit="m" />
            <StatCard compact label="Max slope" value={ok.stats.maxSlopeDeg.toFixed(1)} unit="°" sub={`limit ${limit}°`} />
            <StatCard compact label="Mission time" value={missionTime.value} unit={missionTime.unit} />
          </div>
        )}
        {outcome && outcome.status !== 'ok' && (
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>{outcome.status === 'no-route' ? 'No route for this profile' : 'Planner error'}</AlertTitle>
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )}
        <button
          type="button"
          onClick={() => dispatch({ type: 'goto', step: 'driver' })}
          className="w-full rounded-xl border border-border px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${summary}. Change the driver`}
        >
          <span className="block font-medium">{summary}</span>
          <span className="block text-xs text-muted-foreground">Tap to change; your points stay</span>
        </button>
      </div>
      <Actions>
        <Button variant="outline" className="h-12 flex-1" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
        <Button className="h-12 flex-[2] bg-brand text-base font-semibold text-brand-foreground hover:bg-brand/90" disabled={!ok} onClick={go}>
          <Play className="size-5" aria-hidden="true" />
          Start the journey
        </Button>
      </Actions>
    </>
  )
}

/** Panel body of "Plan a route" while the wizard runs (steps Who, Options, Review; the map steps show only the banner and a hint). */
export function WizardPanel() {
  const step = useWizard((s) => s.step)
  const dispatch = useWizard((s) => s.dispatch)
  const free = useDriver((s) => s.kind !== 'astar' && s.mode === 'free')
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-3 max-md:px-3.5">
        <WizardStepper />
      </div>
      {(step === 'start' || step === 'goal') && (
        <div className="space-y-3 px-4 py-4 max-md:px-3.5">
          <p className="text-lg font-semibold">
            Tap the map to set <span className="text-brand">{step === 'start' ? 'START' : 'GOAL'}</span>
          </p>
          <p className="text-sm text-muted-foreground">{free ? 'Free drive: the AI finds its own way.' : 'The planned route shows its waypoints.'}</p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => dispatch({ type: 'back' })}>
              {step === 'start' ? 'Cancel' : 'Back'}
            </Button>
          </div>
        </div>
      )}
      {step === 'who' && <Who />}
      {step === 'driver' && <Driver />}
      {step === 'how' && <How />}
      {step === 'options' && <Options />}
      {step === 'review' && <Review />}
    </div>
  )
}
