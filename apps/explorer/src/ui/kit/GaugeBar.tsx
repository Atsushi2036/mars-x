import { cn } from '@/lib/utils'

/** Value against a limit, one hue. `neutral` keeps it primary for scores where higher is better (no warning colour). Turns warning at 80 % and danger past the limit (the number is always printed next to it). */
export function GaugeBar({ value, limit, label, neutral, className }: { value: number; limit: number; label: string; neutral?: boolean; className?: string }) {
  const ratio = limit > 0 ? value / limit : 0
  const tone = neutral ? 'bg-primary' : ratio > 1 ? 'bg-destructive' : ratio >= 0.8 ? 'bg-warning' : 'bg-primary'
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(value, limit)}
      aria-valuetext={`${value.toFixed(1)} of ${limit}`}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]', tone)} style={{ width: `${Math.max(2, Math.min(1, ratio) * 100)}%` }} />
    </div>
  )
}
