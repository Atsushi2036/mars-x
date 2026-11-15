import { ChevronRight, ExternalLink } from '@/ui/icons'
import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtBytes, fmtElevation, fmtInt } from '@/lib/format'
import { useApp } from '@/store/app'
import { Details, HonestyChip, Metric, PanelSection, StatCard } from '@/ui/kit'
import { DISCLAIMER, NOT_COVERED } from '../replay/scorecard'
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
        <span className="text-base font-semibold text-foreground">{title}</span>
        {summary && <span className="ml-auto text-xs text-muted-foreground">{summary}</span>}
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  )
}

function LayerSource({ s }: { s: SourceGroup }) {
  const doi = doiUrl(s.doi)
  const url = safeHttps(s.url)
  return (
    <li className="space-y-1 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-5">{s.title}</p>
        <ProvenanceChip kind={s.provenance} />
      </div>
      <p className="text-muted-foreground">{s.attribution}</p>
      <dl className="space-y-0.5 pt-0.5">
        <Metric label="License" value={s.license} />
        <Metric label="DOI" value={doi ? <Ext href={doi}>{s.doi}</Ext> : 'None'} />
        <Metric label="Resolution" value={fmtRes(s.resM)} />
      </dl>
      <p className="text-xs leading-4 text-muted-foreground">
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
    <li className="space-y-1 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-4">{s.title}</p>
        {s.provenance && <ProvenanceChip kind={s.provenance} />}
      </div>
      <p className="text-muted-foreground">{s.credit}</p>
      <p className="text-muted-foreground">{s.use}</p>
      <dl>
        <Metric label="License" value={s.license} />
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
    <PanelSection title="Validation" caption="How well the terrain agrees with what Perseverance measured.">
      {v.status === 'loading' && (
        <div className="grid grid-cols-2 gap-2" role="status" aria-label="Loading the validation report">
          <Skeleton className="h-[110px] rounded-2xl" />
          <Skeleton className="h-[110px] rounded-2xl" />
        </div>
      )}
      {v.status === 'missing' && <p className="text-sm text-muted-foreground">No validation report ships with this dataset, so no agreement figures are shown.</p>}
      {v.status === 'invalid' && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>The validation report could not be read</AlertTitle>
          <AlertDescription>It does not follow the expected format, so none of its numbers are shown.</AlertDescription>
        </Alert>
      )}
      {v.status === 'ready' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {headlines(v.report).map((h) => {
              const r = /^r = ([\d.]+)/.exec(h.big)
              return (
                <StatCard
                  key={h.id}
                  label={h.title}
                  value={h.big}
                  provenance="derived"
                  className={h.id === 'align' ? 'col-span-2' : undefined}
                  gauge={r ? { value: Number(r[1]), limit: 1, label: h.title + ', correlation against 1' } : undefined}
                />
              )
            })}
          </div>
          <Details summary="How to read these numbers">
            <ul className="space-y-3">
              {headlines(v.report).map((h) => (
                <li key={h.id} className="space-y-1">
                  <p className="font-medium">{h.title}</p>
                  <p className="text-xs text-muted-foreground">{h.bigLabel}</p>
                  <dl className="divide-y divide-border">
                    {h.lines.map(([k, val]) => (
                      <Metric key={k} label={k} value={val} />
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">{h.caveat}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">{REFERENCE_NOTE}</p>
            <p className="font-mono text-xs text-muted-foreground">Report generated {v.report.generatedAt.slice(0, 10)}</p>
          </Details>
        </>
      )}
    </PanelSection>
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
        <div className="px-4 pt-4">
          <Alert>
            <AlertTitle>Synthetic terrain</AlertTitle>
            <AlertDescription>This is generated test terrain in the real data format. The real Jezero dataset replaces it when present.</AlertDescription>
          </Alert>
        </div>
      )}

      <PanelSection title="Dataset">
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Resolution" value={g.resM} unit="m/px" provenance="measured" />
          <StatCard label="Extent" value={`${fmtInt(g.width * g.resM)} × ${fmtInt(g.height * g.resM)}`} unit="m" provenance="derived" className="[&_p:nth-child(2)]:text-2xl" />
        </div>
        <dl className="divide-y divide-border">
          <Metric label="Elevation" value={`${fmtElevation(hf.zMin)} to ${fmtElevation(hf.zMax)}`} />
        </dl>
      </PanelSection>

      <Validation base={ds.synthetic ? undefined : ds.base} />

      <PanelSection title="Data sources" className="pb-0" caption="Read from the dataset manifest, so credits match the data on screen.">
        <div className="-mx-4 border-t border-border">
          <Disclosure title="Map data" summary={`${groups.length} products`}>
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
      </PanelSection>

      <PanelSection title="Scope & limits" caption="MARS-X is a first filter. It does not certify anything.">
        <HonestyChip />
        <Details summary="What this test does NOT cover">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {NOT_COVERED.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            Imagery is the HiRISE RED band, a single monochrome band, in a false-colour tint. The CRISM mineral layer is a machine-learning product with preliminary attributions. Hazard limits and the astronaut profile are engineering assumptions, not official rover constraints.
          </p>
        </Details>
      </PanelSection>

      <PanelSection>
        <Details summary="Technical details">
          <dl className="divide-y divide-border">
            <Metric label="Id" value={m.datasetId} mono />
            <Metric label="Version" value={m.version} mono />
            <Metric label="Grid" value={`${fmtInt(g.width)} × ${fmtInt(g.height)} px`} />
            <Metric label="Vertical datum" value={m.crs.verticalDatum} />
            <Metric label="Elevation file" value={fmtBytes(ds.elevationLayer.bytes)} />
            <Metric label="Content hash" value={<span title={m.contentHash}>{m.contentHash.slice(0, 12)}…</span>} mono />
          </dl>
        </Details>
      </PanelSection>

      <PanelSection title="Notice">
        <p className="text-sm text-muted-foreground">{DISCLAIMER}</p>
        <p className="text-xs text-muted-foreground">Built with AI assistance (Claude Code) under the team&apos;s direction.</p>
      </PanelSection>
    </div>
  )
}
