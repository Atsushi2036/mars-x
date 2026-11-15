import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PROFILES } from '@/intelligence/nav/profiles'
import { fmtInt } from '@/lib/format'
import { useApp } from '@/store/app'
import { useMission, type MissionProfile } from '@/store/mission'
import { ROVER_REAL_SPEED } from '@/store/watch'
import { beginJourney } from './journey'
import { AstronautIcon, CircleAlert, Play, RoverIcon, type LucideIcon } from '../icons'
import { Segmented, StatCard } from '../kit'
import { MarswalkSetup } from '../panels/MarswalkPanel'
import { WizardStepper } from './PlanWizard'
import { missionTimeParts } from './machine'
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
  const { outcome, planning } = useOutcome()
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
        <p className="min-h-6 text-sm text-muted-foreground" role="status">
          {planning && !outcome ? 'Planning the route…' : outcome?.status === 'ok' ? `Route ready: ${fmtInt(outcome.stats.lengthM)} m` : outcome ? 'No safe route for this profile' : ''}
        </p>
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
        <p className="text-sm text-muted-foreground">{PROFILE_LABEL[profile]} · you will see the journey through its eyes.</p>
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
          <p className="text-sm text-muted-foreground">The panel stays here on desktop; on a phone it steps aside.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => dispatch({ type: 'back' })}>
              {step === 'start' ? 'Cancel' : 'Back'}
            </Button>
          </div>
        </div>
      )}
      {step === 'who' && <Who />}
      {step === 'options' && <Options />}
      {step === 'review' && <Review />}
    </div>
  )
}
