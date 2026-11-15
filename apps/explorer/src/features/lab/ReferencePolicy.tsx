import { CircleAlert, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { policyCardSchema, type PolicyCard } from '@/intelligence'
import { fmtBytes } from '@/lib/format'
import { useApp } from '@/store/app'
import { Section } from '@/ui/panels/Section'
import { useByo } from '../shared/byo-store'
import { short } from '../shared/fmt'
import { honestSummary } from './reference'

type CardState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; card: PolicyCard }

/** The PPO we trained, offered as a ready-made policy to try the drop flow, with its model card told straight. */
export function ReferencePolicy() {
  const ds = useApp((s) => s.dataset)
  const loaded = useByo((s) => s.policy.loaded)
  const busy = useByo((s) => s.policy.loading)
  const loadPolicy = useByo((s) => s.actions.loadPolicy)
  const [state, setState] = useState<CardState>({ status: 'loading' })
  const [fetching, setFetching] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!ds) return
    let live = true
    fetch(`${ds.base}/models/policy-card.json`)
      .then(async (r) => {
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('missing')
        return policyCardSchema.parse(await r.json())
      })
      .then((card) => live && setState({ status: 'ready', card }))
      .catch(() => live && setState({ status: 'missing' }))
    return () => {
      live = false
    }
  }, [ds])

  const use = async () => {
    if (!ds) return
    setFetching(true)
    setErr(null)
    try {
      const r = await fetch(`${ds.base}/models/policy.onnx`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      loadPolicy(new File([blob], 'policy.onnx', { type: 'application/octet-stream' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setFetching(false)
    }
  }

  return (
    <Section title="Reference policy" hint="A PPO network we trained, so you can try the full flow and have something to compare against.">
      {state.status === 'loading' && <Skeleton className="h-24 w-full" role="status" aria-label="Loading the model card" />}
      {state.status === 'missing' && <p className="text-xs text-muted-foreground">The reference policy is not published with this build.</p>}
      {state.status === 'ready' && <Card card={state.card} />}
      {state.status === 'ready' && (
        <>
          <Button variant="outline" className="h-10 w-full md:h-8" disabled={fetching || busy || !!loaded} onClick={() => void use()} aria-describedby={loaded ? 'ref-why' : undefined}>
            <Download /> {fetching ? 'Fetching…' : 'Load the reference policy'}
          </Button>
          {loaded && (
            <p id="ref-why" className="text-[11px] text-muted-foreground">
              Disabled: a policy is already loaded. Remove it below first.
            </p>
          )}
          {err && (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
              <CircleAlert className="size-3.5" aria-hidden="true" /> Could not fetch it: {err}
            </p>
          )}
        </>
      )}
    </Section>
  )
}

function Card({ card }: { card: PolicyCard }) {
  const h = honestSummary(card)
  const t = card.training
  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3 text-xs">
      <div>
        <p className="text-sm font-medium">{card.name}</p>
        <p className="font-mono text-[11px] text-muted-foreground" title={card.onnxSha256}>
          v{card.version} · {fmtBytes(card.onnxBytes)} · sha256 {short(card.onnxSha256, 12)}
        </p>
      </div>
      <dl className="space-y-1.5">
        <div>
          <dt className="text-muted-foreground">Inside its training distribution</dt>
          <dd>{h.inDistribution}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">On the official benchmark</dt>
          <dd className="font-medium">{h.official}</dd>
          <dd className="font-medium text-destructive">{h.verdict}</dd>
        </div>
        {t && (
          <div>
            <dt className="text-muted-foreground">Training</dt>
            <dd>
              {t.algorithm}, {t.library}, {t.timesteps.toLocaleString('en-US')} steps, seed {t.seed}
            </dd>
          </div>
        )}
      </dl>
      <p className="leading-4 text-muted-foreground">{card.limitations}</p>
      <p className="text-[11px] text-muted-foreground">License {card.license}.</p>
    </div>
  )
}
