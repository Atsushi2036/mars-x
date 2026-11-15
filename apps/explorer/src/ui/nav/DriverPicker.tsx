import { useEffect } from 'react'
import { useModelCatalog } from '@/features/shared/model-catalog'
import { useByo } from '@/features/shared/byo-store'
import { captureUserModel, useUserModel } from '@/intelligence/drive/user-model'
import { useApp } from '@/store/app'
import { DRIVER_ENABLED, driverLabel, setDriver, useDriver, type DriverKind } from '@/store/driver'
import { cn } from '@/lib/utils'
import { Bot, FlaskConical, Route, Sparkles } from '@/ui/icons'

interface Option {
  kind: DriverKind
  label: string
  icon: typeof Route
  /** why it cannot be picked right now (undefined = available) */
  why?: string
}

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
 * "Who drives?": the A* plan, every model of the build catalog (PPO reference, the example student model) and "Your model", the ONNX
 * dropped in Test your AI. Place it after planning (the Watch stack and the wizard's review step use it). An option that cannot be
 * picked is disabled and says why.
 */
export function DriverPicker({ className }: { className?: string }) {
  const kind = useDriver((s) => s.kind)
  const phase = useDriver((s) => s.phase)
  const ref = useDriver((s) => s.referenceStatus)
  const catalog = useModelCatalog()
  const file = useUserModel((s) => s.file)
  const fromCatalog = useUserModel((s) => s.catalogId)
  const loaded = useByo((s) => s.policy.loaded)
  const name = useByo((s) => s.policy.fileName)
  const hasCatalog = catalog.status === 'ready' && catalog.models.length > 0
  useProbeReference(catalog.status !== 'loading' && !hasCatalog)
  useEffect(() => captureUserModel(), [])
  useEffect(() => {
    useDriver.setState({ catalog: catalog.models })
  }, [catalog.models])

  const userOk = !!file && !!loaded && !fromCatalog
  const options: Option[] = [{ kind: 'astar', label: 'A* plan', icon: Route }]
  if (hasCatalog) for (const m of catalog.models) options.push({ kind: `catalog:${m.id}`, label: m.kind === 'reference' ? 'Reference AI' : 'Example model', icon: m.kind === 'reference' ? Bot : Sparkles })
  else options.push({ kind: 'reference', label: 'Reference AI', icon: Bot, why: ref === 'missing' ? 'The reference model is not published with this build' : undefined })
  options.push({ kind: 'user', label: 'Your model', icon: FlaskConical, why: userOk ? undefined : 'Drop an ONNX policy in Test your AI first' })

  // a selection that stopped being available (model removed, catalog gone) falls back to the A* plan
  useEffect(() => {
    const cur = options.find((o) => o.kind === kind)
    if (kind !== 'astar' && (!cur || cur.why)) setDriver('astar')
  })
  if (!DRIVER_ENABLED) return null
  const busy = phase === 'loading' || phase === 'driving'
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div role="radiogroup" aria-label="Who drives?" className="glass pointer-events-auto flex gap-0.5 rounded-full p-0.5">
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
              title={off ? o.why : driverLabel(o.kind, name, catalog.models)}
              onClick={() => !off && !busy && setDriver(o.kind)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:px-3',
                on ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted',
                (off || busy) && 'cursor-not-allowed opacity-50',
              )}
            >
              <o.icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {o.label}
            </button>
          )
        })}
      </div>
      {!userOk && (
        <p className="glass pointer-events-auto rounded-full px-2.5 py-0.5 text-xs text-muted-foreground">
          Your model: drop an ONNX in{' '}
          <button type="button" onClick={() => useApp.getState().setMode('lab')} className="font-medium text-primary underline-offset-2 hover:underline">
            Test your AI
          </button>
        </p>
      )}
    </div>
  )
}
