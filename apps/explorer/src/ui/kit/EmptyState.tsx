import type { ReactNode } from 'react'

export type Illustration = 'route' | 'model' | 'runs' | 'data'

/** Original 96 px line illustrations (no stock art). Strokes use the theme tokens. */
function Art({ kind }: { kind: Illustration }) {
  const c = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2 } as const
  return (
    <svg viewBox="0 0 96 96" className="size-24" aria-hidden="true">
      <ellipse cx="48" cy="80" rx="34" ry="6" className="fill-muted" />
      {kind === 'route' && (
        <>
          <path d="M22 70C22 52 44 56 48 44S62 34 74 26" {...c} className="stroke-planner" strokeDasharray="2 7" />
          <circle cx="22" cy="70" r="6" {...c} className="fill-card stroke-planner" />
          <path d="M74 14v22M74 14l12 5-12 5" {...c} className="stroke-brand" />
        </>
      )}
      {kind === 'model' && (
        <>
          <rect x="24" y="34" width="48" height="34" rx="8" {...c} className="stroke-muted-foreground" />
          <path d="M48 54V16M38 26l10-10 10 10" {...c} className="stroke-brand" />
          <circle cx="36" cy="52" r="2.5" className="fill-planner" />
          <circle cx="60" cy="52" r="2.5" className="fill-planner" />
        </>
      )}
      {kind === 'runs' && (
        <>
          <path d="M20 70V52M36 70V38M52 70V46M68 70V28" {...c} strokeWidth={7} className="stroke-muted-foreground/40" />
          <path d="M16 56L36 38L52 46L76 22" {...c} className="stroke-brand" />
          <circle cx="76" cy="22" r="4" className="fill-brand" />
        </>
      )}
      {kind === 'data' && (
        <>
          <ellipse cx="48" cy="28" rx="22" ry="8" {...c} className="stroke-planner" />
          <path d="M26 28v20c0 4.4 9.8 8 22 8s22-3.6 22-8V28M26 48v14c0 4.4 9.8 8 22 8s22-3.6 22-8V48" {...c} className="stroke-muted-foreground" />
        </>
      )}
    </svg>
  )
}

/** One illustration, one line of text, one call to action. */
export function EmptyState({ art, title, line, cta }: { art: Illustration; title: string; line?: string; cta?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <Art kind={art} />
      <p className="text-lg font-semibold leading-6">{title}</p>
      {line && <p className="max-w-[30ch] text-sm text-muted-foreground">{line}</p>}
      {cta && <div className="mt-2 w-full max-w-xs">{cta}</div>}
    </div>
  )
}
