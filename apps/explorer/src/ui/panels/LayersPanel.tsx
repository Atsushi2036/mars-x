import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LAYER_DEFS, ORDERED_LAYERS, layerAvailability, type Legend } from '@/scene/layers/layer-defs'
import { useApp, type LayerId } from '@/store/app'
import { LayerLegend } from './LayerLegend'
import { Section } from './Section'

/** Legend items for the CRISM layer come from the manifest (class colours and counts), only classes present in the window. */
function useLegend(id: LayerId): Legend {
  const ds = useApp((s) => s.dataset)
  return useMemo(() => {
    const def = LAYER_DEFS[id]
    if (def.legend.kind !== 'categorical' || !def.legend.fromManifest) return def.legend
    const layer = ds?.manifest.layers.find((l) => l.id === def.manifestId)
    const items = (layer?.legend ?? []).filter((i) => (i.pixels ?? 0) > 0).map((i) => ({ color: i.color, label: i.label }))
    return { kind: 'categorical', items }
  }, [id, ds])
}

/** One line on what the slip layer really shows in this window (derived from the manifest, not hard-coded). */
function useSlipNote(): string | null {
  const ds = useApp((s) => s.dataset)
  const layer = ds?.manifest.layers.find((l) => l.id === 'slip_class')
  const items = (layer?.legend ?? []).filter((i) => (i.pixels ?? 0) > 0)
  if (items.length === 1 && items[0]) return `THEMIS is 100 m/px: the whole window falls in one class (${items[0].label}), so there is no variation to show here.`
  return null
}

function ActiveLayer({ id }: { id: LayerId }) {
  const def = LAYER_DEFS[id]
  const legend = useLegend(id)
  const opacity = useApp((s) => s.layerOpacity)
  const setOpacity = useApp((s) => s.setLayerOpacity)
  const load = useApp((s) => s.layerLoad)
  const slipNote = useSlipNote()
  const titleId = `legend-${id}`
  const status = load && load.id === id ? load : null
  return (
    <Section title={def.title} hint={def.description}>
      {def.badge && (
        <Badge variant="outline" className="font-normal">
          {def.badge}
        </Badge>
      )}
      {status?.state === 'loading' && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading layer data
        </p>
      )}
      {status?.state === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          Could not load this layer. {status.message}
        </p>
      )}
      <p id={titleId} className="sr-only">
        {def.title} legend
      </p>
      <LayerLegend legend={legend} labelledBy={titleId} />
      {id === 'slip' && slipNote && <p className="text-xs text-muted-foreground">{slipNote}</p>}
      <p className="text-[11px] leading-4 text-muted-foreground">Source: {def.sourceNote}</p>
      <label className="block space-y-1.5 pt-1 text-xs">
        <span className="flex justify-between text-muted-foreground">
          Opacity <span className="font-mono tabular-nums text-foreground">{Math.round(opacity * 100)}%</span>
        </span>
        <Slider min={0.1} max={1} step={0.05} value={[opacity]} onValueChange={([v]) => setOpacity(v ?? 0.7)} aria-label="Layer opacity" />
      </label>
    </Section>
  )
}

export function LayersPanel() {
  const layer = useApp((s) => s.layer)
  const setLayer = useApp((s) => s.setLayer)
  const ds = useApp((s) => s.dataset)
  const ortho = ds?.orthoLayer
  const traverseOn = useApp((s) => s.showTraverse)
  const setTraverse = useApp((s) => s.setShowTraverse)
  const hasTraverse = !!ds?.manifest.layers.some((l) => l.id === 'traverse') && !!ds?.manifest.layers.some((l) => l.id === 'waypoints')

  const availability = useMemo(
    () => Object.fromEntries(ORDERED_LAYERS.map((id) => [id, ds ? layerAvailability(id, ds.manifest) : ({ ok: true } as const)])),
    [ds],
  )
  const unavailable = ORDERED_LAYERS.filter((id) => !availability[id]!.ok)

  return (
    <div>
      <Section title="Base imagery">
        <p className="text-sm leading-5">{ortho ? 'HiRISE orthoimage, 25 cm/px' : 'Shaded relief'}</p>
        <p className="text-xs text-muted-foreground">
          HiRISE RED band, false-color tint. The source image is a single monochrome band; colours are applied for legibility and are
          not what the surface looks like.
        </p>
      </Section>

      <Section title="Overlay">
        <ToggleGroup
          type="single"
          value={layer}
          onValueChange={(v) => v && setLayer(v as LayerId)}
          variant="outline"
          spacing={0}
          className="grid w-full grid-cols-3"
          aria-label="Overlay layer"
        >
          {ORDERED_LAYERS.map((id) => {
            const a = availability[id]!
            return (
              <ToggleGroupItem
                key={id}
                value={id}
                disabled={!a.ok}
                className="h-10 px-1 text-xs md:h-8"
                title={a.ok ? undefined : a.reason}
                aria-describedby={a.ok ? undefined : `why-${id}`}
              >
                {LAYER_DEFS[id].label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        {unavailable.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {unavailable.map((id) => {
              const a = availability[id]!
              return (
                <li key={id} id={`why-${id}`}>
                  <span className="text-foreground">{LAYER_DEFS[id].label}:</span> {a.ok ? '' : a.reason}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {layer !== 'none' && <ActiveLayer id={layer} />}

      <Section title="Perseverance traverse" hint="The real drive tracks and every recorded waypoint inside this window.">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="traverse-switch" className="text-sm">
            Show traverse and waypoints
          </label>
          <Switch id="traverse-switch" checked={traverseOn} onCheckedChange={setTraverse} disabled={!hasTraverse} />
        </div>
        {!hasTraverse && <p className="text-xs text-muted-foreground">Not in this dataset: no traverse file was published.</p>}
        {traverseOn && (
          <p className="text-xs text-muted-foreground">
            Click a diamond to see the rover&apos;s measured tilt next to the DEM slope. The path was planned by humans with science goals:
            a reference, not ground truth.
          </p>
        )}
        <p className="text-[11px] leading-4 text-muted-foreground">Source: NASA/JPL-Caltech, Mars 2020 MMGIS (snapshot).</p>
      </Section>
    </div>
  )
}
