import { cn } from '@/lib/utils'
import type { LucideIcon } from '../icons'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** one short line, about 24 characters */
  sub?: string
  icon?: LucideIcon
  disabled?: boolean
}

/**
 * Big selectable cards (radio group), 64 px high at least, so they are a comfortable touch target.
 * Default layout: icon and label in a row. `stacked`: icon on top, label under it (three narrow options).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  columns,
  stacked,
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  label: string
  columns?: 2 | 3
  stacked?: boolean
}) {
  const cols = columns ?? (options.length === 2 ? 2 : 3)
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', cols === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
      {options.map((o) => {
        const on = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex min-h-16 min-w-0 flex-col justify-center gap-0.5 rounded-xl border px-2.5 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              stacked ? 'items-center text-center' : 'items-start text-left',
              on ? 'border-primary bg-primary/10' : 'border-border bg-transparent hover:bg-muted',
            )}
          >
            {stacked && Icon && <Icon className={cn('size-6 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} aria-hidden="true" />}
            <span className={cn('flex min-w-0 items-center gap-2 text-sm font-medium', stacked ? 'max-w-full' : 'w-full')}>
              {!stacked && Icon && <Icon className={cn('size-6 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} aria-hidden="true" />}
              <span className={stacked ? 'leading-tight' : 'truncate'}>{o.label}</span>
            </span>
            {o.sub && <span className={cn('text-xs text-muted-foreground', stacked ? 'max-w-full' : 'w-full truncate')}>{o.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}
