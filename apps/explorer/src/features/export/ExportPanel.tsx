import { Check, ChevronDown, Copy, Download, PackageOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Section } from '@/ui/panels/Section'
import { CONTENTS, fmtSize, packageUrl, parseExportIndex, scenarioName, type ExportIndex, type ExportPackage } from './packages'

type Load = { status: 'loading' } | { status: 'ready'; index: ExportIndex } | { status: 'unavailable'; reason: string }

function useExportIndex(base: string | null): Load {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  useEffect(() => {
    if (!base) return
    const ctl = new AbortController()
    fetch(`${base}/export/index.json`, { signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('missing')
        return parseExportIndex(await res.json())
      })
      .then((index) => setLoad({ status: 'ready', index }))
      .catch((e) => {
        if (ctl.signal.aborted) return
        setLoad({ status: 'unavailable', reason: e instanceof Error && e.message === 'missing' ? 'This dataset does not include export packages.' : 'The export index could not be read.' })
      })
    return () => ctl.abort()
  }, [base])
  return load
}

function CopyHash({ hash }: { hash: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={done ? 'sha256 copied' : 'Copy sha256'}
      className="size-9 shrink-0 md:size-7"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(hash)
          .then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          })
          .catch(() => undefined)
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  )
}

function PackageCard({ p, base }: { p: ExportPackage; base: string }) {
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{scenarioName(p.scenarioId)}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{p.scenarioId}</p>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{fmtSize(p.bytes)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        g = {p.gravity.toFixed(3)} m/s²
        {p.sunElevationDeg != null && p.ltstH != null ? ` · Sun ${p.sunElevationDeg.toFixed(1)}° at ${String(Math.floor(p.ltstH)).padStart(2, '0')}:${String(Math.round((p.ltstH % 1) * 60)).padStart(2, '0')} LTST` : ''}
        {p.meshVsDem ? ` · mesh vs DEM: rms ${p.meshVsDem.rmsM.toFixed(2)} m, p95 ${p.meshVsDem.p95M.toFixed(2)} m, max ${p.meshVsDem.maxM.toFixed(2)} m` : ''}
      </p>
      <div className="flex items-start gap-1 rounded-md bg-surface px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">sha256</p>
          <p className="break-all font-mono text-[11px] leading-4">{p.sha256}</p>
        </div>
        <CopyHash hash={p.sha256} />
      </div>
      <Button asChild className="h-10 w-full md:h-8">
        <a href={packageUrl(base, p)} download={p.zip}>
          <Download /> Download ZIP
        </a>
      </Button>
    </li>
  )
}

export function ExportPanel() {
  const base = useApp((s) => s.dataset?.base ?? null)
  const load = useExportIndex(base)
  const [open, setOpen] = useState(false)
  return (
    <Section title="Export to Gazebo / Isaac Sim" hint="Take the exact benchmark scenario, terrain included, to a higher-fidelity simulator.">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="h-auto whitespace-normal py-1 text-left">
          Gazebo: SDF validated, not run in Gazebo
        </Badge>
        <Badge variant="outline" className="h-auto whitespace-normal py-1 text-left">
          Isaac Sim: not tested (OBJ for the MeshConverter)
        </Badge>
      </div>

      <div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          What is in each package
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {open && (
          <dl className="mt-1 divide-y divide-border rounded-lg border border-border px-3">
            {CONTENTS.map((c) => (
              <div key={c.file} className="space-y-0.5 py-2 text-xs">
                <dt className="font-mono">{c.file}</dt>
                <dd className="text-muted-foreground">{c.what}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {load.status === 'loading' && (
        <div role="status" aria-label="Loading the export packages" className="space-y-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      )}
      {load.status === 'unavailable' && (
        <Alert>
          <PackageOpen />
          <AlertTitle>No export packages</AlertTitle>
          <AlertDescription>{load.reason}</AlertDescription>
        </Alert>
      )}
      {load.status === 'ready' && base && (
        <ul className="space-y-2.5" aria-label="Export packages">
          {load.index.packages.map((p) => (
            <PackageCard key={p.zip} p={p} base={base} />
          ))}
        </ul>
      )}
      {load.status === 'ready' && load.index.packages.length === 0 && <p className="text-xs text-muted-foreground">This dataset lists no packages.</p>}

      <p className="text-[11px] leading-4 text-muted-foreground">
        The mesh is decimated to 8 m; the GeoTIFF keeps the full 1 m elevations. The Sun comes from Mars24 at the scenario time. Check the download with <span className="font-mono">sha256sum</span> against the value above. Simulation only: a first filter, not flight qualification.
      </p>
    </Section>
  )
}
