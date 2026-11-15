import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CircleAlert, CircleX, Check, FileText, LoaderCircle, Play } from '@/ui/icons'
import { Chip, Learn, PanelSection, StatCard } from '@/ui/kit'
import { useByo } from '../shared/byo-store'
import { short } from '../shared/fmt'
import { useModelCatalog, type CatalogEntry } from '../shared/model-catalog'

/** Scrolls the "Benchmark run" section into view once the run.json is on its way (the card appears there). */
function revealRun() {
  requestAnimationFrame(() => document.getElementById('lab-run')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
}

function pct(v: number | undefined) {
  return v === undefined ? '—' : (v * 100).toFixed(1)
}

function ModelCard({ entry, primary }: { entry: CatalogEntry; primary: boolean }) {
  const cat = useModelCatalog()
  const loaded = useByo((s) => s.policy.loaded)
  const policyLoading = useByo((s) => s.policy.loading)
  const runLoading = useByo((s) => s.run.loading)
  const [err, setErr] = useState<string | null>(null)
  const isLoaded = loaded?.sha256 === entry.sha256
  const downloading = cat.busy === `${entry.id}:model`
  const fetchingRun = cat.busy === `${entry.id}:L1`
  const hasL1 = !!entry.runs.L1

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e))
  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-3.5" aria-label={entry.name}>
      <div className="space-y-1.5">
        <p className="text-base font-medium leading-6">{entry.name}</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip>v{entry.version}</Chip>
          <Chip className="font-mono" title={entry.sha256}>
            {short(entry.sha256, 8)}
          </Chip>
          <Chip tone={entry.kind === 'reference' ? 'primary' : 'neutral'}>{entry.kind === 'reference' ? 'reference' : 'example'}</Chip>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatCard compact label="Official L1" value={pct(entry.official.L1?.success)} unit="%" provenance="modeled" sub={entry.official.L1 ? `n = ${entry.official.L1.n}` : undefined} />
        <StatCard compact label="Official L2" value={pct(entry.official.L2?.success)} unit="%" provenance="modeled" sub={entry.official.L2 ? `n = ${entry.official.L2.n}` : undefined} />
      </div>
      <p className="flex items-center gap-2 text-sm font-medium">
        {entry.passesL1 ? <Check className="size-5 text-success" aria-hidden="true" /> : <CircleX className="size-5 text-destructive" aria-hidden="true" />}
        {entry.passesL1 ? 'Passes L1' : 'Does not pass L1'}
        <span className="text-xs font-normal text-muted-foreground">needs 80%</span>
      </p>
      <div className="grid grid-cols-1 gap-2">
        <Button
          variant={primary && !isLoaded ? 'default' : 'outline'}
          className="h-11 gap-2"
          disabled={isLoaded || policyLoading || !!cat.busy}
          onClick={() => {
            setErr(null)
            cat.loadModel(entry.id).catch(fail)
          }}
        >
          {downloading || (policyLoading && !isLoaded) ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : isLoaded ? <Check className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
          {isLoaded ? 'Loaded' : downloading ? 'Downloading…' : 'Load model'}
        </Button>
        <Button
          variant="outline"
          className="h-11 gap-2"
          disabled={!hasL1 || runLoading || !!cat.busy}
          aria-describedby={hasL1 ? undefined : `no-run-${entry.id}`}
          onClick={() => {
            setErr(null)
            cat.loadBenchmark(entry.id, 'L1').then(revealRun, fail)
          }}
        >
          {fetchingRun || runLoading ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <FileText className="size-5" aria-hidden="true" />}
          See its benchmark
        </Button>
      </div>
      {!hasL1 && (
        <p id={`no-run-${entry.id}`} className="text-xs text-muted-foreground">
          Its official run is not published here. Run the benchmark yourself and drop the run.json below.
        </p>
      )}
      {err && (
        <Alert variant="destructive" role="alert">
          <CircleAlert />
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}
    </li>
  )
}

/** One-click catalog on top of "Bring your model": no files to find. The drop zones stay below for your own model. */
export function TryAModel() {
  const cat = useModelCatalog()
  if (cat.status === 'unavailable') return null
  return (
    <PanelSection
      title="Try a model"
      caption="Ready-made, one click. Official results, not the in-training number."
      action={
        <Learn title="What you load">
          <p>The ONNX file is downloaded from this site, checked against its sha256 and then validated exactly like a file you drop. It runs inside this page and is not sent anywhere.</p>
          <p>See its benchmark loads the official run: the numbers are recomputed here by re-simulation, never trusted from the file.</p>
        </Learn>
      }
    >
      {cat.status === 'loading' ? (
        <div role="status" aria-label="Loading the model catalog" className="space-y-2">
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Ready-made models">
          {cat.models.map((m, i) => (
            <ModelCard key={m.id} entry={m} primary={i === 0} />
          ))}
        </ul>
      )}
    </PanelSection>
  )
}
