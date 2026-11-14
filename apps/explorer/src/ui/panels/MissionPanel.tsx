import { CircleAlert, MapPin, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PROFILES } from '@/intelligence/nav/profiles'
import { fmtDeg, fmtInt, fmtLat, fmtLon } from '@/lib/format'
import { useApp } from '@/store/app'
import { useMission, type MissionProfile } from '@/store/mission'
import { Row, Section } from './Section'

const PROFILE_LABEL: Record<MissionProfile, string> = { astronaut: 'Astronaut', 'rover-rtg': 'Rover RTG', 'rover-solar': 'Rover solar' }

function Endpoint({ label, at, active }: { label: string; at: { x: number; z: number } | null; active: boolean }) {
  const ds = useApp((s) => s.dataset)
  const ll = at && ds ? ds.heightfield.worldToLonLat(at.x, at.z) : null
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${active ? 'border-brand/70 bg-brand/10' : 'border-border'}`}
      aria-current={active ? 'step' : undefined}
    >
      <MapPin className="size-4 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{label}</p>
        <p className="truncate font-mono tabular-nums text-muted-foreground">
          {ll ? `${fmtLat(ll.lat)}  ${fmtLon(ll.lon)}` : active ? 'Click the terrain to place it' : 'Not set'}
        </p>
      </div>
    </div>
  )
}

export function MissionPanel() {
  const ds = useApp((s) => s.dataset)
  const m = useMission()
  const { ensureLayers } = m
  useEffect(() => {
    if (ds) void ensureLayers(ds)
  }, [ds, ensureLayers])

  const outcome = m.outcomes[m.profile]
  const both = !!m.origin && !!m.destination

  return (
    <div>
      <Section title="Endpoints" hint="Click the terrain to place the origin, then the destination. Clicking again replaces them.">
        <div className="space-y-2">
          <Endpoint label="Origin" at={m.origin} active={m.placing === 'origin'} />
          <Endpoint label="Destination" at={m.destination} active={m.placing === 'destination'} />
        </div>
        <div className="flex gap-2">
          <ToggleGroup
            type="single"
            value={m.placing}
            onValueChange={(v) => v && m.setPlacing(v as 'origin' | 'destination')}
            variant="outline"
            spacing={0}
            className="flex-1"
            aria-label="Endpoint to place"
          >
            <ToggleGroupItem value="origin" className="h-10 flex-1 md:h-8">
              Set origin
            </ToggleGroupItem>
            <ToggleGroupItem value="destination" className="h-10 flex-1 md:h-8">
              Set destination
            </ToggleGroupItem>
          </ToggleGroup>
          <Button variant="ghost" size="icon" aria-label="Clear endpoints" className="size-10 md:size-8" disabled={!m.origin && !m.destination} onClick={m.clear}>
            <Trash2 />
          </Button>
        </div>
      </Section>

      <Section title="Traverse profile" hint="Each profile has its own slope limit and cost weights.">
        <ToggleGroup
          type="single"
          value={m.profile}
          onValueChange={(v) => v && m.setProfile(v as MissionProfile)}
          variant="outline"
          spacing={0}
          className="w-full"
          aria-label="Traverse profile"
        >
          {(Object.keys(PROFILE_LABEL) as MissionProfile[]).map((id) => (
            <ToggleGroupItem key={id} value={id} className="h-10 flex-1 px-1 text-xs md:h-8">
              {PROFILE_LABEL[id]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Slope limit {PROFILES[m.profile].maxSlope}° ·{' '}
          {PROFILES[m.profile].provenance === 'sourced' ? 'sourced limit' : 'assumption, editable later in the lab'}
        </p>
      </Section>

      <Section title="Route">
        {m.layersStatus === 'loading' && (
          <div className="space-y-2" role="status" aria-label="Loading planning layers">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {m.layersStatus === 'error' && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Planning layers failed to load</AlertTitle>
            <AlertDescription>{m.layersError}</AlertDescription>
          </Alert>
        )}
        {m.layersStatus === 'ready' && !both && (
          <p className="text-xs text-muted-foreground">
            {m.origin ? 'Place the destination to plan a route.' : 'Place an origin and a destination to plan a route.'}
          </p>
        )}
        {m.layersStatus === 'ready' && both && m.planning && !outcome && (
          <div className="space-y-2" role="status" aria-label="Planning">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {outcome?.status === 'ok' && (
          <dl className="space-y-1.5">
            <Row label="Distance" value={`${fmtInt(outcome.stats.lengthM)} m`} />
            <Row label="Max slope" value={fmtDeg(outcome.stats.maxSlopeDeg)} />
            <Row label="Mean slope" value={fmtDeg(outcome.stats.meanSlopeDeg)} />
            <Row label="Climb" value={`${fmtInt(outcome.stats.climbM)} m`} />
            <Row label="Nodes expanded" value={fmtInt(outcome.expanded)} />
            <Row label="Planned in" value={`${outcome.ms.toFixed(0)} ms`} />
          </dl>
        )}
        {outcome && outcome.status !== 'ok' && (
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>{outcome.status === 'no-route' ? 'No route for this profile' : 'Planner error'}</AlertTitle>
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )}
        {m.layers && (
          <p className="text-[11px] text-muted-foreground">
            {m.layers.origin === 'pipeline'
              ? `Planning on the ${m.layers.grid.res} m grid, worst-case slope per cell.`
              : `Planning on slopes derived from elevation (${m.layers.grid.res} m grid).`}
          </p>
        )}
      </Section>

      {both && Object.keys(m.outcomes).length > 0 && (
        <Section title="All profiles">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1 font-normal">Profile</th>
                <th className="pb-1 text-right font-normal">Distance</th>
                <th className="pb-1 text-right font-normal">Max slope</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {(Object.keys(PROFILE_LABEL) as MissionProfile[]).map((id) => {
                const o = m.outcomes[id]
                return (
                  <tr key={id} className="border-t border-border">
                    <td className="py-1.5 font-sans">{PROFILE_LABEL[id]}</td>
                    <td className="py-1.5 text-right">{o?.status === 'ok' ? `${fmtInt(o.stats.lengthM)} m` : '—'}</td>
                    <td className="py-1.5 text-right">{o?.status === 'ok' ? fmtDeg(o.stats.maxSlopeDeg) : o ? 'No route' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}
