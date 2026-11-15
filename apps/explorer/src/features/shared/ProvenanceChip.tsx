import { cn } from '@/lib/utils'
import { CircleDashed, Cpu, Ruler, Sigma, type LucideIcon } from '@/ui/icons'
import { PROVENANCE_META, type Provenance } from './provenance'

// text stays foreground (AA on every tint in both themes); border, tint and icon carry the kind
const TONE: Record<Provenance, string> = {
  measured: 'border-chart-1/40 bg-chart-1/10 text-foreground [&>svg]:text-chart-1',
  derived: 'border-chart-3/40 bg-chart-3/10 text-foreground [&>svg]:text-chart-3',
  modeled: 'border-chart-4/40 bg-chart-4/10 text-foreground [&>svg]:text-chart-4',
  assumption: 'border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground',
}

const ICON: Record<Provenance, LucideIcon> = { measured: Ruler, derived: Sigma, modeled: Cpu, assumption: CircleDashed }

/** Small pill telling where a value comes from. Icon + word carry the meaning, colour is secondary. */
export function ProvenanceChip({ kind, className }: { kind: Provenance; className?: string }) {
  const m = PROVENANCE_META[kind]
  const Icon = ICON[kind]
  return (
    <span
      title={m.hint}
      className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium leading-none', TONE[kind], className)}
    >
      <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      {m.label}
    </span>
  )
}
