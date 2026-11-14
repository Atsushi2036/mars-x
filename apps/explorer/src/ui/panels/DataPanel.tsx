import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtBytes, fmtElevation, fmtInt } from '@/lib/format'
import { useApp } from '@/store/app'
import { Row, Section } from './Section'

export function DataPanel() {
  const ds = useApp((s) => s.dataset)
  if (!ds) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }
  const m = ds.manifest
  // derived layers share their parent's source: list each distinct source once, with the layers it feeds
  const sources = new Map<string, { layer: (typeof m.layers)[number]; ids: string[] }>()
  for (const l of m.layers) {
    const key = `${l.source.title}|${l.source.attribution}|${l.source.license}|${l.origin}`
    const e = sources.get(key)
    if (e) e.ids.push(l.id)
    else sources.set(key, { layer: l, ids: [l.id] })
  }
  const g = m.grid
  const hf = ds.heightfield
  return (
    <div>
      {ds.synthetic && (
        <div className="px-4 pt-3.5">
          <Alert>
            <AlertTitle>Synthetic terrain</AlertTitle>
            <AlertDescription>
              This is generated test terrain in the real data format. The real Jezero dataset replaces it automatically when present.
            </AlertDescription>
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
        </dl>
      </Section>

      <Section title="Sources">
        <ul className="space-y-3">
          {[...sources.entries()].map(([key, { layer: l, ids }]) => (
            <li key={key} className="space-y-0.5 text-xs">
              <p className="font-medium text-foreground">{l.source.title}</p>
              <p className="text-muted-foreground">{l.source.attribution}</p>
              <p className="text-muted-foreground">
                {l.source.license}
                {l.source.doi ? ` · doi:${l.source.doi}` : ''}
              </p>
              <p className="text-muted-foreground">
                {l.origin === 'observed' ? 'Observed' : l.origin === 'derived' ? 'Derived from observations' : 'Simulated'}
                {' · '}
                {ids.join(', ')}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Notice">
        <p className="text-xs leading-5 text-muted-foreground">
          Not affiliated with or endorsed by NASA, JPL or Caltech. Imagery colours are a false-colour tint of a single monochrome band.
          Built with AI assistance (Claude Code).
        </p>
      </Section>
    </div>
  )
}
