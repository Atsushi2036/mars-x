import { z } from 'zod'

/**
 * `<data base>/export/index.json` (schema export-index/1): one ZIP per benchmark scenario, each with the
 * terrain and a Gazebo world. The page only offers a download link and shows the sha256 so the user can verify it.
 */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

const packageSchema = z.object({
  scenarioId: z.string().max(96),
  zip: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.zip$/i).max(96),
  bytes: z.number().int().positive(),
  sha256,
  gravity: z.number().positive(),
  ltstH: z.number().nullish(),
  sunElevationDeg: z.number().nullish(),
  meshStepCells: z.number().int().positive().nullish(),
  /** mesh error against the 1 m DEM, when the index carries it (always present in each package's manifest.json) */
  meshVsDem: z.object({ rmsM: z.number(), p95M: z.number(), maxM: z.number() }).nullish(),
})
export type ExportPackage = z.infer<typeof packageSchema>

export const indexSchema = z.object({
  schema: z.literal('export-index/1'),
  datasetId: z.string().max(64),
  packages: z.array(packageSchema).max(64),
})
export type ExportIndex = z.infer<typeof indexSchema>

export function parseExportIndex(json: unknown): ExportIndex {
  return indexSchema.parse(json)
}

export const SCENARIO_NAMES: Record<string, string> = {
  'jezero-v1/l1/rtg-geometry': 'L1 · RTG rover, geometry only',
  'jezero-v1/l1/astronaut-geometry': 'L1 · Astronaut, geometry only',
  'jezero-v1/l2/solar-clear': 'L2 · Solar rover, clear sol',
  'jezero-v1/l2/solar-storm': 'L2 · Solar rover, dust storm',
  'jezero-v1/l2/rtg-storm': 'L2 · RTG rover, dust storm',
  'jezero-v1/l2/astronaut-clear': 'L2 · Astronaut, clear sol',
  'jezero-v1/l3/rtg-clear': 'L3 · RTG rover, hidden rocks',
}

export const scenarioName = (id: string) => SCENARIO_NAMES[id] ?? id

/** Download URL of a package; the file name is validated by the schema, so it cannot leave the export folder. */
export const packageUrl = (base: string, p: Pick<ExportPackage, 'zip'>) => `${base}/export/${p.zip}`

export function fmtSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`
}

/** What each file in a package is (from the README inside the ZIP). */
export const CONTENTS: ReadonlyArray<{ file: string; what: string }> = [
  { file: 'terrain.tif', what: 'GeoTIFF, float32 metres, 1 m resolution (the full-resolution elevations)' },
  { file: 'terrain.glb', what: 'glTF 2.0 mesh, decimated to 8 m, with the orthophoto (web viewers, Isaac Sim importer)' },
  { file: 'terrain.obj / .mtl', what: 'Same mesh as OBJ, Z up (Gazebo; Isaac Lab MeshConverter)' },
  { file: 'scenario.json', what: 'The benchmark scenario: agent limits, conditions, start and goal, with the provenance of each number' },
  { file: 'world.sdf', what: 'Gazebo world with Mars gravity 3.694 m/s² and the Sun from Mars24 at the scenario time. No plugins.' },
  { file: 'manifest.json', what: 'sha256 of every file, frame, Sun, gravity and the mesh error against the DEM' },
  { file: 'ATTRIBUTION.txt', what: 'Sources and licences' },
]
