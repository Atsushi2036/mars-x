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

/** Big selectable cards (radio group): icon 24 + two lines. 64 px high, so it is a comfortable touch target. */
export function Segmented<T extends string>({ value, onChange, options, label, columns }: { value: T; onChange: (v: T) => void; options: SegmentedOption<T>[]; label: string; columns?: 2 | 3 }) {
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
              'flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              on ? 'border-primary bg-primary/10' : 'border-border bg-transparent hover:bg-muted',
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium">
              {Icon && <Icon className={cn('size-6 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} aria-hidden="true" />}
              <span className="truncate">{o.label}</span>
            </span>
            {o.sub && <span className="w-full truncate text-xs text-muted-foreground">{o.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}
