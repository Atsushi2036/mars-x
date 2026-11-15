import { Popover } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Info } from '../icons'

/** "Learn more" without a paragraph: an info button that opens the long text in a popover. One per card. */
export function Learn({ title, children, label = 'Learn more', className }: { title?: string; children: ReactNode; label?: string; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={title ? `${label}: ${title}` : label}
        className={cn('inline-grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        <Info className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-popover p-4 text-sm leading-6 text-popover-foreground shadow-float outline-none"
        >
          {title && <p className="mb-1 font-semibold">{title}</p>}
          <div className="space-y-2 text-muted-foreground">{children}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Collapsed block for jargon and technical values ("Details"). Native disclosure: keyboard and screen reader ready. */
export function Details({ summary = 'Details', children, defaultOpen = false }: { summary?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-xl border border-border">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {summary}
        <span aria-hidden="true" className="text-base leading-none transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-border px-3 py-2 text-sm">{children}</div>
    </details>
  )
}
