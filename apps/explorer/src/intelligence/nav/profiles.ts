import { z } from 'zod'
import type { CostWeights } from './astar'

/**
 * Traverse profiles planned in parallel (one Worker each). Limits come from the design spec:
 * rover slope limit 24 deg (raised Oct 2026), operator mode 30 deg; astronaut and solar-rover
 * weights are ASSUMPTIONS (provenance below) and editable in the lab.
 */
export const profileIdSchema = z.enum(['astronaut', 'rover-rtg', 'rover-solar'])
export type ProfileId = z.infer<typeof profileIdSchema>

export interface Profile extends CostWeights {
  id: ProfileId
  label: string
  provenance: 'sourced' | 'assumption'
}

export const PROFILES: Readonly<Record<ProfileId, Profile>> = {
  astronaut: { id: 'astronaut', label: 'Astronaut (EVA)', ws: 6, wr: 0, maxSlope: 20, provenance: 'assumption' },
  'rover-rtg': { id: 'rover-rtg', label: 'Rover (RTG)', ws: 4, wr: 0, maxSlope: 24, provenance: 'sourced' },
  'rover-solar': { id: 'rover-solar', label: 'Rover (solar)', ws: 6, wr: 0, maxSlope: 20, provenance: 'assumption' },
}

export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[]

export const costWeightsSchema = z
  .object({
    ws: z.number().finite().min(0).max(1000),
    wr: z.number().finite().min(0).max(1000),
    maxSlope: z.number().finite().positive().max(90),
  })
  .strict()
