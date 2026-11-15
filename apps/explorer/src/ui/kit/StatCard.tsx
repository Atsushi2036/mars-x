import type { ReactNode } from 'react'
import { ProvenanceChip } from '@/features/shared/ProvenanceChip'
import type { Provenance } from '@/features/shared/provenance'
import { cn } from '@/lib/utils'
import { GaugeBar } from './GaugeBar'

export interface StatCardProps {
  label: string
  value: ReactNode
  unit?: string
  provenance?: Provenance
  /** one short line under the number */
  sub?: ReactNode
  /** draws a bar of `value` against `limit` */
  gauge?: { value: number; limit: number; label: string }
  /** smaller number (text-2xl) for three-across grids */
  compact?: boolean
  className?: string
}

/** Big number + unit + provenance chip. The single way a panel shows a headline value. */
export function StatCard({ label, value, unit, provenance, sub, gauge, compact, className }: StatCardProps) {
  return (
    <div className={cn('flex min-h-[92px] min-w-0 flex-col gap-1 rounded-2xl border border-border bg-surface/60 p-3.5 max-md:p-3', className)}>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn('flex items-baseline gap-1 font-semibold tabular-nums leading-none', compact ? 'text-2xl' : 'text-3xl')}>
        <span className="min-w-0 truncate">{value}</span>
        {unit && <span className="text-sm font-normal text-muted-foreground">{unit}</span>}
      </p>
      {gauge && <GaugeBar {...gauge} className="mt-1" />}
      {(provenance || sub) && (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
          {provenance && <ProvenanceChip kind={provenance} />}
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </div>
      )}
    </div>
  )
}

/** Compact label/value line for the few facts that are not headline numbers. */
export function Metric({ label, value, provenance, mono }: { label: string; value: ReactNode; provenance?: Provenance; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('flex min-w-0 items-center gap-2 text-right tabular-nums', mono && 'font-mono text-xs')}>
        <span className="min-w-0 truncate">{value}</span>
        {provenance && <ProvenanceChip kind={provenance} />}
      </dd>
    </div>
  )
}
