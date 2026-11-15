/**
 * Public API of the intelligence layer (consumed by src/features/{lab,replay}).
 * Everything heavy runs in Web Workers; nothing here touches the DOM except the hooks.
 */

// React bindings
export { usePlanner, useQLearning, usePolicy, useRunFile } from './hooks'
export type { LearnerSnapshot, PlannerLayers, QStatus, WatchPlan } from './hooks'

// Navigation (A*/Dijkstra, profiles, pool)
export { PlannerPool } from './nav/planner-pool'
export type { PlanAllResult, PlanQuery } from './nav/planner-pool'
export type { PlanResult } from './nav/planner-service'
export { astar, dijkstraCostToGoal, bottleneckSlope, costLayers, combineCost } from './nav/astar'
export type { NoRouteCause, CostWeights, CostLayers } from './nav/astar'
export { PROFILES, PROFILE_IDS } from './nav/profiles'
export type { Profile, ProfileId } from './nav/profiles'

// Q-learning lab
export { QLearner, DEFAULT_QPARAMS } from './lab/qlearn'
export { FLAG_BUMP, FLAG_EXPLORE, NO_ACTION } from './lab/qlearn'
export type { QParams, QSetup, EpisodePoint, EpisodeSample, GreedyEval } from './lab/qlearn'

// ONNX policy
export { PolicyClient } from './policy/policy-client'
export type { LoadedPolicy } from './policy/policy-client'
export { validateOnnx, MAX_MODEL_BYTES } from './policy/onnx-validate'

// run.json + replay
export { RunSession } from './replay/run-loader'
export type { RunLoadResult } from './replay/run-service'
export { EnvLite, costMap } from './sim/env-lite'
export type { EnvConfig, Terrain, EnvState } from './sim/env-lite'
export { replayEpisode } from './sim/replay'
export type { ReplayReport } from './sim/replay'
export { computeMetrics, diffMetrics, wilsonCi95 } from './sim/metrics'

// Condition tables
export { HorizonMaps, SunTable, OwltTable, decodeSkyView, slipClassLabel, f32FromBytes } from './conditions/tables'

// Contracts (owned by the ai-engineer)
export * from './contracts'
