import { useCamera, type CameraMode } from '@/store/camera'
import { useMission } from '@/store/mission'
import { cn } from '@/lib/utils'
import { CircleHelp, Eye, Footprints, Orbit, type LucideIcon } from '@/ui/icons'
import { replayHints } from './store'

interface Item {
  id: CameraMode
  label: string
  title: string
  icon: LucideIcon
  key: string
}

/**
 * Camera dock: always on screen, bottom centre. Three big modes (Orbit, Walk, Follow = the POV of the rover or astronaut),
 * each with icon, label and its key. The `?` re-shows the controls hint of the current camera.
 */
export function CameraDock({ onHelp }: { onHelp: () => void }) {
  const mode = useCamera((s) => s.mode)
  const setMode = useCamera((s) => s.setMode)
  const profile = useMission((s) => s.profile)
  const agent = profile === 'astronaut' ? 'astronaut' : 'rover'
  const items: Item[] = [
    { id: 'orbit', label: 'Orbit', title: 'Orbit: fly around the terrain', icon: Orbit, key: '1' },
    { id: 'fpv', label: 'Walk', title: 'Walk: stand on the surface and look around', icon: Footprints, key: '2' },
    { id: 'chase', label: 'Follow', title: `Follow: see through the ${agent}'s eyes`, icon: Eye, key: '3' },
  ]
  return (
    <div role="toolbar" aria-label="Camera" className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-2">
      {items.map((it) => {
        const on = mode === it.id
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={on}
            aria-label={`${it.label} camera${it.id === 'chase' ? `, ${agent}` : ''} (${it.key})`}
            title={it.title}
            onClick={() => {
              setMode(it.id)
              replayHints()
            }}
            className={cn(
              'relative flex size-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-medium outline-none transition-colors duration-[var(--dur-fast)] focus-visible:ring-2 focus-visible:ring-ring md:h-14 md:w-[4.5rem]',
              on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground/80 hover:bg-muted hover:text-foreground',
            )}
          >
            <it.icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
            <span className="leading-none">{it.label}</span>
            <span
              aria-hidden="true"
              className={cn('keycap absolute right-1 top-1 !h-4 !min-w-4 !px-1 !text-[0.6875rem] [@media(pointer:coarse)]:hidden', on && '!border-primary-foreground/40 !bg-primary-foreground/15 !text-primary-foreground')}
            >
              {it.key}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        aria-label="Controls help (H)"
        title="Controls help (H)"
        onClick={onHelp}
        className="ml-0.5 grid size-9 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:size-11"
      >
        <CircleHelp className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  )
}
