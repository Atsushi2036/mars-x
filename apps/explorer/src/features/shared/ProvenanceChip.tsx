import { cn } from '@/lib/utils'
import { PROVENANCE_META, type Provenance } from './provenance'

const TONE: Record<Provenance, string> = {
  measured: 'border-chart-1/40 bg-chart-1/10 text-chart-1',
  derived: 'border-chart-3/40 bg-chart-3/10 text-chart-3',
  modeled: 'border-chart-4/40 bg-chart-4/10 text-chart-4',
  assumption: 'border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground',
}

/** Small pill telling where a value comes from. The meaning is in the text, colour is secondary. */
export function ProvenanceChip({ kind, className }: { kind: Provenance; className?: string }) {
  const m = PROVENANCE_META[kind]
  return (
    <span
      title={m.hint}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[10.5px] font-medium leading-none',
        TONE[kind],
        className,
      )}
    >
      {m.label}
    </span>
  )
}
