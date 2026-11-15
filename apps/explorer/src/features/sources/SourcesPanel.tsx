import { ChevronRight, ExternalLink } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtBytes, fmtElevation, fmtInt } from '@/lib/format'
import { useApp } from '@/store/app'
import { Row, Section } from '@/ui/panels/Section'
import { cn } from '@/lib/utils'
import { DISCLAIMER, NOT_COVERED, STAMP } from '../replay/scorecard'
import { ProvenanceChip } from '../shared/ProvenanceChip'
import { EXTRA_SOURCES, type ExtraSource } from './extras'
import { doiUrl, fmtRes, groupSources, safeHttps, type SourceGroup } from './sources'
import { headlines, REFERENCE_NOTE, validationSchema, type ValidationReport } from './validation'

function Ext({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span>{children}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all rounded text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  )
}

function Disclosure({ title, summary, defaultOpen = false, children }: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-b border-border last:border-b-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 outline-none focus-visible:bg-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="text-xs font-medium text-foreground">{title}</span>
        {summary && <span className="ml-auto text-[11px] text-muted-foreground">{summary}</span>}
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  )
}

function LayerSource({ s }: { s: SourceGroup }) {
  const doi = doiUrl(s.doi)
  const url = safeHttps(s.url)
  return (
    <li className="space-y-1 rounded-lg border border-border p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-4">{s.title}</p>
        <ProvenanceChip kind={s.provenance} />
      </div>
      <p className="text-muted-foreground">{s.attribution}</p>
      <dl className="space-y-0.5 pt-0.5">
        <Row label="License" value={s.license} />
        <Row label="DOI" value={doi ? <Ext href={doi}>{s.doi}</Ext> : 'None'} />
        <Row label="Resolution" value={fmtRes(s.resM)} />
      </dl>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Used for: <span className="font-mono">{s.layers.join(', ')}</span>
      </p>
      {url && (
        <p className="pt-0.5">
          <Ext href={url}>Source</Ext>
        </p>
      )}
    </li>
  )
}

function ExtraItem({ s }: { s: ExtraSource }) {
  return (
    <li className="space-y-1 rounded-lg border border-border p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-4">{s.title}</p>
        {s.provenance && <ProvenanceChip kind={s.provenance} />}
      </div>
      <p className="text-muted-foreground">{s.credit}</p>
      <p className="text-muted-foreground">{s.use}</p>
      <dl>
        <Row label="License" value={s.license} />
      </dl>
      <p>
        <Ext href={safeHttps(s.url)}>{s.doi ? `doi:${s.doi}` : 'Source'}</Ext>
      </p>
    </li>
  )
}

type Report = { status: 'loading' } | { status: 'missing' } | { status: 'invalid' } | { status: 'ready'; report: ValidationReport }

function useValidation(base: string | undefined): Report {
  const [r, setR] = useState<Report>({ status: 'loading' })
  useEffect(() => {
    if (!base) return
    let live = true
    fetch(`${base}/validation_report.json`)
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return { status: 'missing' } as const
        const p = validationSchema.safeParse(await res.json())
        return p.success ? ({ status: 'ready', report: p.data } as const) : ({ status: 'invalid' } as const)
      })
      .catch(() => ({ status: 'missing' }) as const)
      .then((x) => live && setR(x))
    return () => {
      live = false
    }
  }, [base])
  return r
}

function Validation({ base }: { base: string | undefined }) {
  const v = useValidation(base)
  return (
    <Section title="Validation" hint="How well the terrain agrees with what Perseverance itself measured on the ground.">
      {v.status === 'loading' && (
        <div className="space-y-2" role="status" aria-label="Loading the validation report">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {v.status === 'missing' && <p className="text-xs text-muted-foreground">No validation report ships with this dataset, so no agreement figures are shown.</p>}
      {v.status === 'invalid' && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>The validation report could not be read</AlertTitle>
          <AlertDescription>It does not follow the expected format, so none of its numbers are shown.</AlertDescription>
        </Alert>
      )}
      {v.status === 'ready' && (
        <>
          <ul className="space-y-2.5">
            {headlines(v.report).map((h) => (
              <li key={h.id} className="space-y-1 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{h.title}</p>
                <p className="font-mono text-xl font-semibold tabular-nums leading-6">{h.big}</p>
                <p className="text-[11px] leading-4 text-muted-foreground">{h.bigLabel}</p>
                <dl className="space-y-0.5 pt-1">
                  {h.lines.map(([k, val]) => (
                    <Row key={k} label={k} value={val} />
                  ))}
                </dl>
                <p className="pt-1 text-[11px] leading-4 text-muted-foreground">{h.caveat}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-4 text-muted-foreground">{REFERENCE_NOTE}</p>
          <p className="font-mono text-[11px] text-muted-foreground">Report generated {v.report.generatedAt.slice(0, 10)}</p>
        </>
      )}
    </Section>
  )
}

export function SourcesPanel() {
  const ds = useApp((s) => s.dataset)
  if (!ds) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading sources">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }
  const m = ds.manifest
  const g = m.grid
  const hf = ds.heightfield
  const groups = groupSources(m)
  const physics = EXTRA_SOURCES.filter((s) => s.group === 'Atmosphere and physics')
  const software = EXTRA_SOURCES.filter((s) => s.group === 'Software')

  return (
    <div>
      {ds.synthetic && (
        <div className="px-4 pt-3.5">
          <Alert>
            <AlertTitle>Synthetic terrain</AlertTitle>
            <AlertDescription>This is generated test terrain in the real data format. The real Jezero dataset replaces it when present.</AlertDescription>
          </Alert>
        </div>
      )}

      <Section title="Dataset">
        <dl className="space-y-1.5">
          <Row label="Id" value={m.datasetId} />
          <Row label="Version" value={m.version} />
          <Row label="Grid" value={`${fmtInt(g.width)} × ${fmtInt(g.height)} px`} />
          <Row label="Resolution" value={`${g.resM} m/px`} />
          <Row label="Extent" value={`${fmtInt(g.width * g.resM)} × ${fmtInt(g.height * g.resM)} m`} />
          <Row label="Elevation" value={`${fmtElevation(hf.zMin)} to ${fmtElevation(hf.zMax)}`} />
          <Row label="Vertical datum" value={m.crs.verticalDatum} />
          <Row label="Elevation file" value={fmtBytes(ds.elevationLayer.bytes)} />
          <Row label="Content hash" value={<span title={m.contentHash}>{m.contentHash.slice(0, 12)}…</span>} />
        </dl>
      </Section>

      <Validation base={ds.synthetic ? undefined : ds.base} />

      <div className="border-b border-border">
        <div className="px-4 pt-3.5">
          <h3 className="text-xs font-medium text-muted-foreground">Data sources</h3>
          <p className="mt-0.5 text-xs text-muted-foreground/90">Credits are read from the dataset manifest, so they always match the data on screen.</p>
        </div>
        <Disclosure title="Map data" summary={`${groups.length} products`} defaultOpen>
          <ul className="space-y-2.5">
            {groups.map((s) => (
              <LayerSource key={s.key} s={s} />
            ))}
          </ul>
        </Disclosure>
        <Disclosure title="Atmosphere and physics" summary={`${physics.length} references`}>
          <ul className="space-y-2.5">
            {physics.map((s) => (
              <ExtraItem key={s.id} s={s} />
            ))}
          </ul>
        </Disclosure>
        <Disclosure title="Open-source software" summary={`${software.length} projects`}>
          <ul className="space-y-2.5">
            {software.map((s) => (
              <ExtraItem key={s.id} s={s} />
            ))}
          </ul>
        </Disclosure>
      </div>

      <Section title="Scope & limits" hint="What a result here does and does not mean.">
        <p className={cn('rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium')}>{STAMP}.</p>
        <p className="text-xs leading-5 text-muted-foreground">
          MARS-X is a first filter. It tells you whether a navigation model is worth testing in a higher-fidelity simulator or in the field. It does not certify anything.
        </p>
        <p className="text-xs font-medium">What this test does NOT cover</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
          {NOT_COVERED.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">
          Imagery is the HiRISE RED band, a single monochrome band, shown in a false-colour tint. The CRISM mineral layer is a machine-learning product with preliminary attributions. Hazard limits and the astronaut profile are engineering assumptions, not official rover constraints.
        </p>
      </Section>

      <Section title="Use of AI">
        <p className="text-xs leading-5 text-muted-foreground">MARS-X was built with AI assistance (Claude Code) under the team&apos;s direction.</p>
      </Section>

      <Section title="Notice">
        <p className="text-xs leading-5 text-muted-foreground">{DISCLAIMER}</p>
      </Section>
    </div>
  )
}
