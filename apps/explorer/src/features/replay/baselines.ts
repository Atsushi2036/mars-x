import { z } from 'zod'
import type { LevelId } from './scorecard'

/**
 * Verified baseline scorecards published with the dataset (bench/jezero-v1/baselines, copied to
 * `<data base>/baselines/`). They were produced by `marsx bench scorecard` with full re-simulation on the
 * whole suite, so they are the reference the user's run is compared against.
 */
export const BASELINES = [
  { id: 'astar', file: 'astar.scorecard.json', label: 'A* planner', note: 'classical planner, not machine learning' },
  { id: 'astar-replan', file: 'astar-replan.scorecard.json', label: 'A* + replanning', note: 'replans when a hidden rock is found' },
  { id: 'random', file: 'random.scorecard.json', label: 'Random actions', note: 'lower bound' },
] as const
export type BaselineId = (typeof BASELINES)[number]['id']

const metrics = z.object({
  n: z.number().int().min(0),
  success: z.number().min(0).max(1),
  successCi95: z.tuple([z.number(), z.number()]),
  spl: z.number().nullish(),
  energyRatio: z.number().nullish(),
  violations: z.number().int().min(0),
})

const baselineSchema = z.object({
  schemaVersion: z.literal('scorecard/1'),
  header: z.object({ model: z.string().max(96), suite: z.object({ id: z.string().max(96), version: z.string().max(32) }) }),
  verdict: z.object({
    levels: z.array(z.object({ level: z.enum(['L1', 'L2', 'L3']), passed: z.boolean(), metrics })),
  }),
})
export type BaselineCard = z.infer<typeof baselineSchema>

export interface BaselineRow {
  id: BaselineId
  label: string
  note: string
  n: number
  success: number
  ci: [number, number]
  spl: number | null
  energyRatio: number | null
  violations: number
  passed: boolean
  suite: string
}

export function parseBaseline(json: unknown): BaselineCard {
  return baselineSchema.parse(json)
}

/** The row of one baseline at one level, or null if the baseline did not run that level. */
export function baselineRow(def: (typeof BASELINES)[number], card: BaselineCard, level: LevelId): BaselineRow | null {
  const l = card.verdict.levels.find((x) => x.level === level)
  if (!l) return null
  return {
    id: def.id,
    label: def.label,
    note: def.note,
    n: l.metrics.n,
    success: l.metrics.success,
    ci: l.metrics.successCi95,
    spl: l.metrics.spl ?? null,
    energyRatio: l.metrics.energyRatio ?? null,
    violations: l.metrics.violations,
    passed: l.passed,
    suite: `${card.header.suite.id} ${card.header.suite.version}`,
  }
}

export type BaselineLoad = { status: 'ready'; cards: Partial<Record<BaselineId, BaselineCard>> } | { status: 'unavailable'; reason: string }

/** Fetches the published baselines; missing files are tolerated (the comparison then says what is missing). */
export async function loadBaselines(base: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<BaselineLoad> {
  const cards: Partial<Record<BaselineId, BaselineCard>> = {}
  let failed = 0
  await Promise.all(
    BASELINES.map(async (b) => {
      try {
        const res = await fetcher(`${base}/baselines/${b.file}`, signal ? { signal } : undefined)
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`HTTP ${res.status}`)
        cards[b.id] = parseBaseline(await res.json())
      } catch {
        failed++
      }
    }),
  )
  if (Object.keys(cards).length === 0) return { status: 'unavailable', reason: failed ? 'The baseline scorecards are not published with this dataset.' : 'No baselines.' }
  return { status: 'ready', cards }
}
