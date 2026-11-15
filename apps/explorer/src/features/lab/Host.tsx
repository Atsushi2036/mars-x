import { useEffect, useRef } from 'react'
import { usePolicy, useRunFile } from '@/intelligence'
import { useByo } from '../shared/byo-store'

/** Headless host: owns the ONNX policy Worker and the run.json Worker for the whole session and mirrors them into the store. */
export default function Host() {
  const run = useRunFile()
  const pol = usePolicy()
  const runName = useRef<string | null>(null)
  const polName = useRef<string | null>(null)
  const { load: loadRun, close: closeRun } = run
  const { load: loadPolicy, unload: unloadPolicy } = pol

  useEffect(() => {
    useByo.setState({
      actions: {
        loadRun: (f) => {
          runName.current = f.name
          useByo.setState((s) => ({ run: { ...s.run, fileName: f.name } }))
          void loadRun(f)
        },
        closeRun: () => {
          runName.current = null
          closeRun()
          useByo.setState((s) => ({ run: { ...s.run, error: null, fileName: null } }))
        },
        loadPolicy: (f) => {
          polName.current = f.name
          useByo.setState((s) => ({ policy: { ...s.policy, fileName: f.name } }))
          void loadPolicy(f)
        },
        unloadPolicy: () => {
          polName.current = null
          unloadPolicy()
          useByo.setState((s) => ({ policy: { ...s.policy, error: null, fileName: null } }))
        },
      },
    })
  }, [loadRun, closeRun, loadPolicy, unloadPolicy])

  useEffect(() => {
    useByo.setState((s) => ({ run: { ...s.run, loading: run.loading, error: run.error, session: run.session, result: run.result } }))
  }, [run.loading, run.error, run.session, run.result])

  useEffect(() => {
    useByo.setState((s) => ({ policy: { ...s.policy, loading: pol.loading, error: pol.error, loaded: pol.policy } }))
  }, [pol.loading, pol.error, pol.policy])

  return null
}
