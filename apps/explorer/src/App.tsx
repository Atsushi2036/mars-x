import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { loadFirstAvailable } from '@/core/data/loader'
import { useApp } from '@/store/app'
import { Shell } from '@/ui/Shell'
import { LoadingScreen } from '@/ui/LoadingScreen'
import { ErrorScreen } from '@/ui/ErrorScreen'
import { TooltipProvider } from '@/components/ui/tooltip'
import { hasWebGL2 } from '@/lib/webgl'

// The 3D scene (three, R3F, drei) is a separate chunk: the shell and the data fetch start without it.
const Scene = lazy(() => import('@/scene/Scene'))

/** `?data=<name>` selects a dataset under /data/ (simple names only); defaults to the real Jezero set, falling back to synthetic. */
function candidates(): string[] {
  const q = new URLSearchParams(window.location.search).get('data')
  return q ? [q] : ['jezero-v1', 'synthetic']
}

export default function App() {
  const status = useApp((s) => s.status)
  const dataset = useApp((s) => s.dataset)
  const [webgl] = useState(() => hasWebGL2())
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!webgl) {
      useApp.getState().setError('webgl')
      return
    }
    const ctl = new AbortController()
    const st = useApp.getState()
    loadFirstAvailable(candidates(), (p) => st.setProgress(p.stage, p.fraction), ctl.signal)
      .then((ds) => useApp.getState().setDataset(ds))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) useApp.getState().setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctl.abort()
  }, [webgl, attempt])

  const retry = useCallback(() => {
    if (!webgl) return window.location.reload()
    useApp.setState({ status: 'loading', error: null, progress: { manifest: 0, elevation: 0, ortho: 0, mesh: 0, ready: 0 } })
    setAttempt((a) => a + 1)
  }, [webgl])

  return (
    <TooltipProvider delayDuration={200}>
      <Shell>
        {dataset && status !== 'error' && (
          <Suspense fallback={null}>
            <Scene dataset={dataset} />
          </Suspense>
        )}
      </Shell>
      {status === 'error' ? <ErrorScreen onRetry={retry} /> : <LoadingScreen />}
    </TooltipProvider>
  )
}
