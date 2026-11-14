import { MonitorOff, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { LogoMark } from './Logo'

/** Data-load failure or missing WebGL2: explains what happened and how to recover. */
export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  const error = useApp((s) => s.error)
  const noGl = error === 'webgl'
  const Icon = noGl ? MonitorOff : TriangleAlert
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-5">
      <div role="alert" className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <LogoMark className="size-9" />
          <span className="text-sm font-semibold tracking-tight">MARS-X Explorer</span>
        </div>
        <div className="flex gap-3">
          <Icon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1.5">
            <h1 className="text-base font-semibold leading-6">{noGl ? '3D graphics are not available' : 'The terrain could not be loaded'}</h1>
            {noGl ? (
              <>
                <p className="text-sm leading-5 text-muted-foreground">
                  This browser cannot create a WebGL 2 context, which the terrain renderer needs.
                </p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  <li>Use a current Chrome, Edge, Firefox or Safari.</li>
                  <li>Enable hardware acceleration in the browser settings.</li>
                  <li>Update the graphics driver, then reload.</li>
                </ul>
              </>
            ) : (
              <>
                <p className="text-sm leading-5 text-muted-foreground">Check your connection and try again.</p>
                <p className="break-words rounded-md bg-surface px-2.5 py-1.5 font-mono text-xs text-muted-foreground">{error}</p>
              </>
            )}
          </div>
        </div>
        <Button className="h-10 w-full md:h-9" onClick={onRetry}>
          {noGl ? 'Reload' : 'Try again'}
        </Button>
      </div>
    </div>
  )
}
