import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Hand, Keyboard, MousePointerClick } from '@/ui/icons'
import { setHelpOpen, useNav } from './store'

const ROWS: { section: string; icon: typeof Hand; items: [string[], string][] }[] = [
  {
    section: 'Mouse',
    icon: MousePointerClick,
    items: [
      [['Drag'], 'Orbit around the point you look at'],
      [['Right-drag'], 'Pan the view'],
      [['Scroll'], 'Zoom towards the cursor'],
      [['Double-click'], 'Fly to that spot'],
    ],
  },
  {
    section: 'Keyboard',
    icon: Keyboard,
    items: [
      [['1', '2', '3'], 'Orbit, Walk, Follow'],
      [['W', 'A', 'S', 'D'], 'Pan (Orbit) or move (Walk)'],
      [['Q', 'E'], 'Rotate'],
      [['+', '−'], 'Zoom'],
      [['R'], 'Home view'],
      [['N'], 'North up'],
      [['F'], 'Centre on the rover'],
      [['Space'], 'Play or pause Watch'],
      [['Esc'], 'Leave Walk, Follow or Watch'],
    ],
  },
  {
    section: 'Touch',
    icon: Hand,
    items: [
      [['Drag'], 'Orbit'],
      [['Pinch'], 'Zoom'],
      [['Two fingers'], 'Pan'],
      [['Double-tap'], 'Fly to that spot'],
    ],
  },
]

/** Controls cheat-sheet: opened by the dock "?" or the H / ? keys. */
export function HelpOverlay() {
  const open = useNav((s) => s.helpOpen)
  return (
    <Dialog open={open} onOpenChange={setHelpOpen}>
      <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Move around Jezero</DialogTitle>
          <DialogDescription>Three cameras: Orbit to look from above, Walk to stand on the surface, Follow to ride with the rover.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {ROWS.map((g) => (
            <section key={g.section} aria-label={g.section}>
              <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                <g.icon className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
                {g.section}
              </h3>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {g.items.map(([keys, what]) => (
                  <li key={what} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{what}</span>
                    <span className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <kbd key={k} className="keycap">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
