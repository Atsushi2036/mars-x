import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { LucideIcon } from '../icons'

export type ChipTone = 'neutral' | 'primary' | 'agent' | 'success' | 'warning' | 'danger'

const TONE: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface text-foreground',
  primary: 'border-primary/40 bg-primary/10 text-primary',
  agent: 'border-brand/50 bg-brand/10 text-foreground',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
}

/** Rounded pill, 28 px high, optional 16 px icon. Meaning lives in icon + word, colour is secondary. */
export function Chip({ tone = 'neutral', icon: Icon, children, className, title }: { tone?: ChipTone; icon?: LucideIcon; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium leading-none whitespace-nowrap', TONE[tone], className)}>
      {Icon && <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </span>
  )
}
