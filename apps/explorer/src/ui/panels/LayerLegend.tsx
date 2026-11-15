import type { Legend } from '@/scene/layers/layer-defs'

/** Accessible legend: a gradient for continuous layers, swatches with text for categories. Colour is never the only cue. */
export function LayerLegend({ legend, labelledBy }: { legend: Legend; labelledBy: string }) {
  if (legend.kind === 'none') return null
  if (legend.kind === 'ramp') {
    return (
      <div className="space-y-1.5" role="group" aria-labelledby={labelledBy}>
        <div
          className="h-2.5 rounded-full ring-1 ring-border"
          style={{ background: `linear-gradient(90deg,${legend.stops.join(',')})` }}
          role="img"
          aria-label={`Colour ramp from ${legend.min} (${legend.stops[0]}) to ${legend.max} (${legend.stops[legend.stops.length - 1]}), ${legend.ramp}`}
        />
        <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{legend.min}</span>
          {legend.mid && <span>{legend.mid}</span>}
          <span>{legend.max}</span>
        </div>
      </div>
    )
  }
  return (
    <ul className="space-y-1" role="group" aria-labelledby={labelledBy}>
      {legend.items.map((it) => (
        <li key={`${it.color}-${it.label}`} className="flex items-center gap-2 text-xs leading-4">
          <span className="size-3 shrink-0 rounded-[3px] ring-1 ring-border" style={{ background: it.color }} aria-hidden="true" />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  )
}
