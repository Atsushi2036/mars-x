import { beforeEach, describe, expect, it } from 'vitest'
import type { Dataset } from '@/core/data/loader'
import { GOAL_TOO_CLOSE, MIN_GOAL_DISTANCE_M, useMission } from './mission'

const ds = {} as Dataset

describe('place(): the goal must be a real distance from the start', () => {
  beforeEach(() => {
    useMission.getState().clear()
    useMission.setState({ placeNotice: null })
  })

  it('accepts the start, then a goal far enough away', () => {
    const m = useMission.getState()
    m.place(ds, { x: 0, z: 0 })
    expect(useMission.getState().origin).toEqual({ x: 0, z: 0 })
    expect(useMission.getState().placing).toBe('destination')
    useMission.getState().place(ds, { x: 100, z: 0 })
    expect(useMission.getState().destination).toEqual({ x: 100, z: 0 })
    expect(useMission.getState().placeNotice).toBeNull()
  })

  it('rejects a goal in the same cell as the start and stays on the Goal step', () => {
    useMission.getState().place(ds, { x: 5, z: 5 })
    useMission.getState().place(ds, { x: 5, z: 5 })
    const s = useMission.getState()
    expect(s.destination).toBeNull()
    expect(s.placing).toBe('destination')
    expect(s.placeNotice).toBe(GOAL_TOO_CLOSE)
  })

  it('rejects a goal 10 m from the start (under the limit) and accepts one just past it', () => {
    useMission.getState().place(ds, { x: 0, z: 0 })
    useMission.getState().place(ds, { x: 10, z: 0 })
    expect(useMission.getState().destination).toBeNull()
    expect(useMission.getState().placeNotice).toBe(GOAL_TOO_CLOSE)
    useMission.getState().place(ds, { x: MIN_GOAL_DISTANCE_M + 1, z: 0 })
    expect(useMission.getState().destination).toEqual({ x: MIN_GOAL_DISTANCE_M + 1, z: 0 })
    expect(useMission.getState().placeNotice).toBeNull()
  })
})
