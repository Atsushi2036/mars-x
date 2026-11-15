import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { fmtBytes } from '@/lib/format'
import { CircleAlert, CircleCheck, ShieldCheck, X } from '@/ui/icons'
import { Chip, Details, Learn, PanelSection } from '@/ui/kit'
import { useByo } from '../shared/byo-store'
import { DropZone } from '../shared/DropZone'
import { short } from '../shared/fmt'
import { RunCard } from '../replay/RunCard'
import { ReferencePolicy } from './ReferencePolicy'
import { explainPolicyError, explainRunError, type Explained } from './errors'

function ErrorBox({ e, onDismiss }: { e: Explained; onDismiss: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert />
      <AlertTitle>{e.headline}</AlertTitle>
      <AlertDescription className="space-y-1.5">
        {e.problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4">
            {e.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p>{e.fix}</p>
        <Button variant="outline" size="sm" className="h-9" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function PolicySection() {
  const p = useByo((s) => s.policy)
  const { loadPolicy, unloadPolicy } = useByo((s) => s.actions)
  const l = p.loaded
  return (
    <PanelSection
      title="ONNX policy"
      caption="Checked and run in this page."
      action={
        <Learn title="The policy/1 contract">
          <p>Input obs [batch, 505], output logits [batch, 9]. The network runs in a Worker with the WebAssembly backend.</p>
        </Learn>
      }
    >
      {!l && <DropZone accept=".onnx" title="Drop a .onnx policy here" chips={['.onnx', 'policy/1']} hint="Up to 20 MB. Checked before any session is created." busy={p.loading} onFile={loadPolicy} />}
      {p.error && <ErrorBox e={explainPolicyError(p.error)} onDismiss={unloadPolicy} />}
      {l && (
        <div className="space-y-3 rounded-2xl border border-border p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{p.fileName ?? 'policy.onnx'}</p>
              <p className="font-mono text-xs text-muted-foreground" title={l.sha256}>
                sha256 {short(l.sha256, 16)}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove the policy" className="-mr-1 size-10" onClick={unloadPolicy}>
              <X className="size-5" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="success" icon={CircleCheck}>
              policy/1 · {l.info.outputName === 'logits' ? 'logits' : 'action'}
            </Chip>
            <Chip>Opset {l.info.opset}</Chip>
            <Chip>{l.info.nodeCount} nodes</Chip>
            <Chip>{fmtBytes(l.bytes)}</Chip>
            <Chip icon={ShieldCheck}>Stays in this page</Chip>
          </div>
          <Details summary="Checks and operators">
            <ul className="space-y-1.5 text-sm">
              <li>Matches the policy/1 contract.</li>
              <li>No loops, scans, conditionals or external data.</li>
              <li>The file is read and run inside this page. It is not sent anywhere.</li>
            </ul>
            <p className="mt-2 flex flex-wrap gap-1 font-mono text-xs text-muted-foreground">
              {l.info.ops.slice(0, 12).map((o) => (
                <span key={o} className="rounded bg-surface px-1.5 py-0.5">
                  {o}
                </span>
              ))}
            </p>
          </Details>
          <p className="text-xs text-muted-foreground">
            For the official scorecard run <span className="font-mono">marsx bench run --policy {p.fileName ?? 'model.onnx'}</span>, then drop the run.json below.
          </p>
        </div>
      )}
    </PanelSection>
  )
}

function RunSection() {
  const r = useByo((s) => s.run)
  const { loadRun, closeRun } = useByo((s) => s.actions)
  return (
    <PanelSection
      title="Benchmark run"
      caption="Numbers are recomputed here, never taken from the file."
      action={
        <Learn title="run.json">
          <p>Drop the file written by the Python SDK. It is validated in a Worker against the run/1 schema.</p>
        </Learn>
      }
    >
      {!r.result && <DropZone accept=".json,application/json" title="Drop a run.json here" chips={['run.json', 'run/1']} hint="Up to 10 MB." busy={r.loading} onFile={loadRun} />}
      {r.error && <ErrorBox e={explainRunError(r.error)} onDismiss={closeRun} />}
      {r.result && <RunCard />}
    </PanelSection>
  )
}

export function ByoModel() {
  return (
    <div>
      <ReferencePolicy />
      <PolicySection />
      <RunSection />
    </div>
  )
}
