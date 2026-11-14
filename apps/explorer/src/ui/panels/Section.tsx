import type { ReactNode } from 'react'

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-border px-4 py-3.5 last:border-b-0">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground/90">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
