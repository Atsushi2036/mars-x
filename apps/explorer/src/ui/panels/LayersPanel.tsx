import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useApp, type LayerId } from '@/store/app'
import { Section } from './Section'

interface LayerDef {
  id: LayerId
  label: string
  /** if set the layer is unavailable and this is why */
  unavailable?: string
}

const LAYERS: LayerDef[] = [
  { id: 'none', label: 'None' },
  { id: 'slope', label: 'Slope' },
  { id: 'hazard', label: 'Hazard', unavailable: 'Hazard map is computed in the Mission slice.' },
  { id: 'crism', label: 'Minerals', unavailable: 'CRISM coverage over this window is not verified yet.' },
]

function SlopeLegend() {
  return (
    <div className="space-y-1.5">
      <div
        className="h-2.5 rounded-full"
        style={{ background: 'linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)' }}
        role="img"
        aria-label="Slope colour ramp from 0 to 30 degrees, purple to yellow"
      />
      <div className="flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>0°</span>
        <span>15°</span>
        <span>30°+</span>
      </div>
    </div>
  )
}

export function LayersPanel() {
  const layer = useApp((s) => s.layer)
  const setLayer = useApp((s) => s.setLayer)
  const opacity = useApp((s) => s.layerOpacity)
  const setOpacity = useApp((s) => s.setLayerOpacity)
  const ds = useApp((s) => s.dataset)
  const ortho = ds?.orthoLayer

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
          className="grid w-full grid-cols-2"
          aria-label="Overlay layer"
        >
          {LAYERS.map((l) => (
            <ToggleGroupItem
              key={l.id}
              value={l.id}
              disabled={!!l.unavailable}
              className="h-10 md:h-8"
              title={l.unavailable}
              aria-describedby={l.unavailable ? `why-${l.id}` : undefined}
            >
              {l.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {LAYERS.filter((l) => l.unavailable).map((l) => (
            <li key={l.id} id={`why-${l.id}`}>
              <span className="text-foreground">{l.label}:</span> {l.unavailable}
            </li>
          ))}
        </ul>
      </Section>

      {layer === 'slope' && (
        <Section title="Slope" hint="Angle of the surface from horizontal, computed from the 1 m elevation model.">
          <SlopeLegend />
          <label className="block space-y-1.5 pt-1 text-xs">
            <span className="flex justify-between text-muted-foreground">
              Opacity <span className="font-mono tabular-nums text-foreground">{Math.round(opacity * 100)}%</span>
            </span>
            <Slider min={0.1} max={1} step={0.05} value={[opacity]} onValueChange={([v]) => setOpacity(v ?? 0.7)} aria-label="Layer opacity" />
          </label>
        </Section>
      )}
    </div>
  )
}
