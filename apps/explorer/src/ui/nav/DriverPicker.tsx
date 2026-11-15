import { useEffect } from 'react'
import { useModelCatalog } from '@/features/shared/model-catalog'
import { useByo } from '@/features/shared/byo-store'
import { captureUserModel, useUserModel } from '@/intelligence/drive/user-model'
import { useApp } from '@/store/app'
import { DRIVER_ENABLED, GUIDED_SPACING_M, setDriveMode, setDriver, trainedRangeWarning, useDriver, type DriveMode, type DriverKind } from '@/store/driver'
import { useMission } from '@/store/mission'
import { cn } from '@/lib/utils'
import { Bot, FlaskConical, Info, Route, Sparkles, TriangleAlert } from '@/ui/icons'

interface Option {
  kind: DriverKind
  label: string
  sub: string
  icon: typeof Route
  /** why it cannot be picked right now (undefined = available) */
  why?: string
}

const MODES: { id: DriveMode; label: string; sub: string }[] = [
  { id: 'guided', label: 'Guided (waypoints)', sub: `A* sets a waypoint every ~${GUIDED_SPACING_M} m and the AI drives from one to the next, the way a rover team works.` },
  { id: 'free', label: 'Free (goal only)', sub: 'Only the start and the goal: the AI finds its own way, with no help.' },
]

/** Whether the built-in reference model is published (only used when the catalog is not): a missing file is served as HTML, not JSON. */
function useProbeReference(enabled: boolean) {
  const base = useApp((s) => s.dataset?.base)
  const status = useDriver((s) => s.referenceStatus)
  useEffect(() => {
    if (!enabled || !base || status !== 'unknown') return
    let live = true
    fetch(`${base}/models/policy-card.json`)
      .then((r) => live && useDriver.setState({ referenceStatus: r.ok && (r.headers.get('content-type') ?? '').includes('json') ? 'ok' : 'missing' }))
      .catch(() => live && useDriver.setState({ referenceStatus: 'missing' }))
    return () => {
      live = false
    }
  }, [enabled, base, status])
}

/**
 * "Who drives?" section of the right panel (Plan a route result and the wizard's Review step): compact cards for the A* plan, each
 * catalog model and "Your model" (the ONNX dropped in Test your AI), then how the AI drives (Guided or Free) and the distance warning.
 * An option that cannot be picked is disabled and says why. The canvas only keeps the Watch button.
 */
export function DriverPicker({ className }: { className?: string }) {
  const kind = useDriver((s) => s.kind)
  const mode = useDriver((s) => s.mode)
  const phase = useDriver((s) => s.phase)
  const notice = useDriver((s) => s.notice)
  const ref = useDriver((s) => s.referenceStatus)
  const catalog = useModelCatalog()
  const file = useUserModel((s) => s.file)
  const fromCatalog = useUserModel((s) => s.catalogId)
  const loaded = useByo((s) => s.policy.loaded)
  const name = useByo((s) => s.policy.fileName)
  const profile = useMission((s) => s.profile)
  const out = useMission((s) => s.outcomes[s.profile])
  const hasCatalog = catalog.status === 'ready' && catalog.models.length > 0
  useProbeReference(catalog.status !== 'loading' && !hasCatalog)
  useEffect(() => captureUserModel(), [])
  useEffect(() => {
    useDriver.setState({ catalog: catalog.models })
  }, [catalog.models])

  const userOk = !!file && !!loaded && !fromCatalog
  const options: Option[] = [{ kind: 'astar', label: 'A* plan', sub: 'Classic search, not AI', icon: Route }]
  if (hasCatalog)
    for (const m of catalog.models)
      options.push({ kind: `catalog:${m.id}`, label: m.kind === 'reference' ? 'Reference AI' : 'Example model', sub: m.kind === 'reference' ? `PPO ${m.version}, trained offline` : `${m.name}, 1.5M steps`, icon: m.kind === 'reference' ? Bot : Sparkles })
  else options.push({ kind: 'reference', label: 'Reference AI', sub: 'PPO 0.2.0, trained offline', icon: Bot, why: ref === 'missing' ? 'The reference model is not published with this build' : undefined })
  options.push({ kind: 'user', label: 'Your model', sub: userOk ? (name ?? 'ONNX policy') : 'Drop an ONNX in Test your AI', icon: FlaskConical, why: userOk ? undefined : 'Drop an ONNX policy in Test your AI first' })

  // a selection that stopped being available (model removed, catalog gone) falls back to the A* plan
  useEffect(() => {
    const cur = options.find((o) => o.kind === kind)
    if (kind !== 'astar' && (!cur || cur.why)) setDriver('astar')
  })
  if (!DRIVER_ENABLED) return null
  const busy = phase === 'loading' || phase === 'driving'
  const ai = kind !== 'astar'
  let straightM = 0
  if (out && out.status === 'ok' && out.path.length > 1) straightM = Math.hypot(out.path[out.path.length - 1]!.x - out.path[0]!.x, out.path[out.path.length - 1]!.z - out.path[0]!.z)
  const range = ai && straightM > 0 ? trainedRangeWarning(straightM) : null
  const rover = profile !== 'astronaut'
  return (
    <section aria-label="Who drives?" className={cn('space-y-2.5', className)}>
      <h3 className="text-sm font-semibold">Who drives?</h3>
      <div role="radiogroup" aria-label="Who drives?" className="grid grid-cols-2 gap-1.5">
        {options.map((o) => {
          const on = kind === o.kind
          const off = !!o.why
          return (
            <button
              key={o.kind}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={off || busy}
              title={off ? o.why : o.sub}
              onClick={() => !off && !busy && setDriver(o.kind)}
              className={cn(
                'flex min-h-14 items-start gap-2 rounded-xl border px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                (off || busy) && 'cursor-not-allowed opacity-55',
              )}
            >
              <o.icon className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{o.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
      {!userOk && (
        <p className="text-xs text-muted-foreground">
          Your model needs an ONNX from{' '}
          <button type="button" onClick={() => useApp.getState().setMode('lab')} className="font-medium text-primary underline-offset-2 hover:underline">
            Test your AI
          </button>
          .
        </p>
      )}
      {ai && (
        <div role="radiogroup" aria-label="How the AI drives" className="space-y-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              aria-disabled={busy}
              onClick={() => !busy && setDriveMode(m.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                mode === m.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              <span aria-hidden="true" className={cn('mt-1 size-3.5 shrink-0 rounded-full border-2', mode === m.id ? 'border-primary bg-primary' : 'border-muted-foreground')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {ai && (
        <p className="flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {rover ? 'The model was trained offline on a rover with hidden rocks and does not pass the v0.1 thresholds.' : 'The reference model was trained for a rover, not for an astronaut: expect it to struggle.'}
        </p>
      )}
      {(range || notice) && (
        <p role="status" className="flex items-start gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{notice ?? range}</span>
        </p>
      )}
    </section>
  )
}
