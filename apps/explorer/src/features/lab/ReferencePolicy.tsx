import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { policyCardSchema, type PolicyCard } from '@/intelligence'
import { fmtBytes } from '@/lib/format'
import { useApp } from '@/store/app'
import { CircleAlert, Download } from '@/ui/icons'
import { Chip, Details, PanelSection } from '@/ui/kit'
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
    <PanelSection title="Reference policy" caption="A PPO we trained, to try the full flow.">
      {state.status === 'loading' && <Skeleton className="h-24 w-full" role="status" aria-label="Loading the model card" />}
      {state.status === 'missing' && <p className="text-sm text-muted-foreground">The reference policy is not published with this build.</p>}
      {state.status === 'ready' && <Card card={state.card} />}
      {state.status === 'ready' && (
        <>
          <Button variant="outline" className="h-11 w-full gap-2" disabled={fetching || busy || !!loaded} onClick={() => void use()} aria-describedby={loaded ? 'ref-why' : undefined}>
            <Download className="size-5" /> {fetching ? 'Fetching…' : 'Load the reference policy'}
          </Button>
          {loaded && (
            <p id="ref-why" className="text-xs text-muted-foreground">
              Disabled: a policy is already loaded. Remove it below first.
            </p>
          )}
          {err && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
              <CircleAlert className="size-4" aria-hidden="true" /> Could not fetch it: {err}
            </p>
          )}
        </>
      )}
    </PanelSection>
  )
}

function Card({ card }: { card: PolicyCard }) {
  const h = honestSummary(card)
  const t = card.training
  return (
    <div className="space-y-3 rounded-2xl border border-border p-3.5 text-sm">
      <div className="space-y-1.5">
        <p className="text-base font-medium">{card.name}</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip>v{card.version}</Chip>
          <Chip>{fmtBytes(card.onnxBytes)}</Chip>
          <Chip className="font-mono" title={card.onnxSha256}>
            {short(card.onnxSha256, 8)}
          </Chip>
        </div>
      </div>
      <dl className="space-y-2">
        <div>
          <dt className="text-xs text-muted-foreground">Inside its training distribution</dt>
          <dd>{h.inDistribution}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">On the official benchmark</dt>
          <dd className="font-medium">{h.official}</dd>
          <dd className="font-medium text-destructive">{h.verdict}</dd>
        </div>
      </dl>
      <Details summary="Training, limits and license">
        <div className="space-y-2 text-sm">
          {t && (
            <p>
              {t.algorithm}, {t.library}, {t.timesteps.toLocaleString('en-US')} steps, seed {t.seed}.
            </p>
          )}
          <p className="text-muted-foreground">{card.limitations}</p>
          <p className="text-xs text-muted-foreground">License {card.license}.</p>
        </div>
      </Details>
    </div>
  )
}
