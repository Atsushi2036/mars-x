import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Compact panel block: title, optional right-hand action, optional ONE-line caption. No blurb by default. */
export function PanelSection({ title, action, caption, children, className }: { title?: string; action?: ReactNode; caption?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3 border-b border-border px-4 py-4 last:border-b-0 max-md:px-3.5', className)}>
      {(title || action) && (
        <div className="flex min-h-8 items-center justify-between gap-2">
          {title && <h3 className="text-base font-semibold leading-6">{title}</h3>}
          {action}
        </div>
      )}
      {caption && <p className="-mt-2 text-xs text-muted-foreground">{caption}</p>}
      {children}
    </section>
  )
}
