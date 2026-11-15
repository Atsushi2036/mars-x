import { Check, Copy, Download, PackageOpen } from '@/ui/icons'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtClock } from '../shared/fmt'
import { useApp } from '@/store/app'
import { Chip, Details, Learn, PanelSection } from '@/ui/kit'
import { CONTENTS, fmtSize, isZipResponse, packageUrl, parseExportIndex, scenarioName, type ExportIndex, type ExportPackage } from './packages'

type Load = { status: 'loading' } | { status: 'ready'; index: ExportIndex; available: ReadonlySet<string> } | { status: 'unavailable'; reason: string }

const NOT_PUBLISHED = 'The export packages are not published in this build.'

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
      .then(async (index) => {
        // never offer a link that would 404: every ZIP is checked with a HEAD request first
        const checks = await Promise.all(
          index.packages.map((p) =>
            fetch(packageUrl(base, p), { method: 'HEAD', signal: ctl.signal })
              .then((r) => isZipResponse(r.ok, r.headers.get('content-type')))
              .catch(() => false),
          ),
        )
        const available = new Set(index.packages.filter((_, i) => checks[i]).map((p) => p.zip))
        if (available.size === 0) throw new Error('missing')
        setLoad({ status: 'ready', index, available })
      })
      .catch((e) => {
        if (ctl.signal.aborted) return
        setLoad({ status: 'unavailable', reason: e instanceof Error && e.message === 'missing' ? NOT_PUBLISHED : 'The export index could not be read.' })
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
      className="size-10 shrink-0"
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
      {done ? <Check className="size-5" /> : <Copy className="size-5" />}
    </Button>
  )
}

function PackageCard({ p, base, available }: { p: ExportPackage; base: string; available: boolean }) {
  return (
    <li className="space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-medium">{scenarioName(p.scenarioId)}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{p.scenarioId}</p>
        </div>
        <Chip className="h-6 tabular-nums">{fmtSize(p.bytes)}</Chip>
      </div>
      <p className="text-xs text-muted-foreground">
        g = {p.gravity.toFixed(3)} m/s²
        {p.sunElevationDeg != null && p.ltstH != null ? ` · Sun ${p.sunElevationDeg.toFixed(1)}° at ${fmtClock(p.ltstH)} LTST` : ''}
        {p.meshVsDem ? ` · mesh vs DEM: rms ${p.meshVsDem.rmsM.toFixed(2)} m, p95 ${p.meshVsDem.p95M.toFixed(2)} m, max ${p.meshVsDem.maxM.toFixed(2)} m` : ''}
      </p>
      <div className="flex items-start gap-1 rounded-xl bg-surface px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">sha256</p>
          <p className="break-all font-mono text-xs leading-4">{p.sha256}</p>
        </div>
        <CopyHash hash={p.sha256} />
      </div>
      {available ? (
        <Button asChild className="h-11 w-full gap-2">
          <a href={packageUrl(base, p)} download={p.zip}>
            <Download className="size-5" /> Download ZIP
          </a>
        </Button>
      ) : (
        <Button disabled className="h-11 w-full gap-2">
          <Download className="size-5" /> Not published in this build
        </Button>
      )}
    </li>
  )
}

export function ExportPanel() {
  const base = useApp((s) => s.dataset?.base ?? null)
  const load = useExportIndex(base)
  return (
    <PanelSection
      title="Export to Gazebo / Isaac Sim"
      caption="The exact benchmark scenario, terrain included."
      action={
        <Learn title="Before you export">
          <p>The mesh is decimated to 8 m; the GeoTIFF keeps the full 1 m elevations. The Sun comes from Mars24 at the scenario time.</p>
          <p>Check the download with sha256sum against the value on the card. Simulation only: a first filter, not flight qualification.</p>
        </Learn>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="warning" className="h-auto max-w-full shrink whitespace-normal py-1 text-left">
          Gazebo: SDF checked against template rules (not run in Gazebo)
        </Chip>
        <Chip tone="warning" className="h-auto max-w-full shrink whitespace-normal py-1 text-left">
          Isaac Sim: not tested (OBJ for the MeshConverter)
        </Chip>
      </div>

      <Details summary="What is in each package">
        <dl className="divide-y divide-border">
          {CONTENTS.map((c) => (
            <div key={c.file} className="space-y-0.5 py-2 text-sm">
              <dt className="font-mono text-xs">{c.file}</dt>
              <dd className="text-muted-foreground">{c.what}</dd>
            </div>
          ))}
        </dl>
      </Details>

      {load.status === 'loading' && (
        <div role="status" aria-label="Loading the export packages" className="space-y-2">
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      )}
      {load.status === 'unavailable' && (
        <Alert>
          <PackageOpen />
          <AlertTitle>No export packages in this build</AlertTitle>
          <AlertDescription className="space-y-1.5">
            <p>{load.reason}</p>
            <p>
              Generate them from the open-source repository with <span className="font-mono">marsx export --demo</span> (the same scenarios, terrain included).
            </p>
          </AlertDescription>
        </Alert>
      )}
      {load.status === 'ready' && base && (
        <ul className="space-y-2.5" aria-label="Export packages">
          {load.index.packages.map((p) => (
            <PackageCard key={p.zip} p={p} base={base} available={load.available.has(p.zip)} />
          ))}
        </ul>
      )}
      {load.status === 'ready' && load.index.packages.length === 0 && <p className="text-sm text-muted-foreground">This dataset lists no packages.</p>}
    </PanelSection>
  )
}
