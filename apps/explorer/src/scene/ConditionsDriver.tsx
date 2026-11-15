import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Dataset } from '@/core/data/loader'
import type { SunTable } from '@/intelligence/conditions/tables'
import { loadMeda, loadSunTable } from '@/features/scenario/data'
import { tableTimeMs } from '@/features/scenario/conditions'
import { scenarioById } from '@/features/scenario/scenarios'
import { useScenario } from '@/features/scenario/store'
import { setHaze, setSun, useApp } from '@/store/app'
import { advanceClock } from '@/store/day-clock'
import { useDay } from '@/store/day'

/**
 * Drives the sun and the haze from the scenario (sol + local mean solar time), whatever panel is open.
 * The sun comes from the Mars24 table published with the dataset; the dust optical depth from MEDA, the
 * scenario or the user's tau override. While the day animation plays it advances the local time every
 * frame (so shadows move smoothly) and mirrors it into the scenario store a few times per second.
 * The manual sun override (app.sunMode === 'manual') switches the sun part off; the haze stays scenario-driven.
 */
export function ConditionsDriver({ ds }: { ds: Dataset }) {
  const sol = useScenario((s) => s.sol)
  const scenarioId = useScenario((s) => s.scenarioId)
  const tauOverride = useScenario((s) => s.tauOverride)
  // results are tagged with their sol, so a stale answer for a previous sol is simply ignored (no reset needed)
  const [sunRes, setSunRes] = useState<{ sol: number; table: { table: SunTable; startMs: number } | null } | null>(null)
  const [tauRes, setTauRes] = useState<{ sol: number; tau: number | null } | null>(null)

  useEffect(() => {
    if (sol === null) return
    let live = true
    void loadSunTable(ds, sol).then((table) => live && setSunRes({ sol, table }))
    void loadMeda(ds, sol).then((m) => live && setTauRes({ sol, tau: m?.tau ?? null }))
    return () => {
      live = false
    }
  }, [ds, sol])
  const sun = sunRes && sunRes.sol === sol ? sunRes.table : null
  const tauMeda = tauRes && tauRes.sol === sol ? tauRes.tau : null

  const tau = tauOverride ?? tauMeda ?? scenarioById(scenarioId).tau?.value ?? null
  useEffect(() => {
    if (tau !== null) setHaze(tau)
  }, [tau])

  const clock = useRef({ h: 0, written: Number.NaN, lastWrite: 0, az: Number.NaN, el: Number.NaN })

  useFrame((_, dt) => {
    if (!sun || useApp.getState().sunMode === 'manual') return
    const c = clock.current
    const sc = useScenario.getState()
    const day = useDay.getState()
    // the slider (or a scenario change) moved the time: adopt it
    if (sc.lmstH !== c.written) c.h = sc.lmstH
    if (day.playing) {
      c.h = advanceClock(c.h, Math.min(dt, 0.1), day.secondsPerSol)
      c.lastWrite += dt
      if (c.lastWrite > 0.2) {
        c.lastWrite = 0
        c.written = Math.round(c.h * 1000) / 1000
        sc.setLmst(c.written)
      }
    }
    try {
      const st = sun.table.at(tableTimeMs(sun.startMs, c.h))
      if (Math.abs(st.azimuthDeg - c.az) > 0.02 || Math.abs(st.elevationDeg - c.el) > 0.02 || Number.isNaN(c.az)) {
        c.az = st.azimuthDeg
        c.el = st.elevationDeg
        setSun(st.azimuthDeg, st.elevationDeg)
      }
    } catch {
      /* time outside the table: keep the last sun */
    }
  })
  return null
}
