import { CircleAlert, CircleCheck, ShieldCheck, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { fmtBytes } from '@/lib/format'
import { Section } from '@/ui/panels/Section'
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
        <Button variant="outline" size="sm" className="h-8" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

function PolicySection() {
  const p = useByo((s) => s.policy)
  const { loadPolicy, unloadPolicy } = useByo((s) => s.actions)
  const l = p.loaded
  return (
    <Section title="ONNX policy" hint="Drag in a policy/1 network: input obs [batch, 505], output logits [batch, 9]. It runs in a Worker with the WebAssembly backend.">
      {!l && <DropZone accept=".onnx" title="Drop a .onnx policy here" hint="Up to 20 MB. Checked before any session is created." busy={p.loading} onFile={loadPolicy} />}
      {p.error && <ErrorBox e={explainPolicyError(p.error)} onDismiss={unloadPolicy} />}
      {l && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.fileName ?? 'policy.onnx'}</p>
              <p className="font-mono text-[11px] text-muted-foreground" title={l.sha256}>
                sha256 {short(l.sha256, 16)}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove the policy" className="-mr-1 size-9 md:size-7" onClick={unloadPolicy}>
              <X />
            </Button>
          </div>
          <ul className="space-y-1 text-xs">
            <Check>Matches the policy/1 contract ({l.info.outputName === 'logits' ? 'logits' : 'action'} output)</Check>
            <Check>
              Opset {l.info.opset}, {l.info.nodeCount} nodes, {fmtBytes(l.bytes)}
            </Check>
            <Check>No loops, scans, conditionals or external data</Check>
          </ul>
          <p className="flex flex-wrap gap-1 font-mono text-[10.5px] text-muted-foreground">
            {l.info.ops.slice(0, 12).map((o) => (
              <span key={o} className="rounded bg-surface px-1.5 py-0.5">
                {o}
              </span>
            ))}
          </p>
          <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            The file is read and run inside this page. It is not sent anywhere.
          </p>
          <p className="rounded-md bg-surface px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
            The official scorecard comes from the benchmark: run <span className="font-mono">marsx bench run --policy {p.fileName ?? 'model.onnx'}</span> and drop the resulting run.json below.
          </p>
        </div>
      )}
    </Section>
  )
}

function RunSection() {
  const r = useByo((s) => s.run)
  const { loadRun, closeRun } = useByo((s) => s.actions)
  return (
    <Section title="Benchmark run (run.json)" hint="Drop the file written by the Python SDK. It is validated in a Worker; the numbers shown are recomputed here, never taken from the file.">
      {!r.result && <DropZone accept=".json,application/json" title="Drop a run.json here" hint="Up to 10 MB, run/1 schema." busy={r.loading} onFile={loadRun} />}
      {r.error && <ErrorBox e={explainRunError(r.error)} onDismiss={closeRun} />}
      {r.result && <RunCard />}
    </Section>
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
