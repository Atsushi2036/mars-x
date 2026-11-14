/**
 * Runtime validator for `manifest.json`. Mirrors packages/schemas/manifest.schema.json (generated
 * from the pydantic models). Keys are camelCase. Required fields and types are enforced (a drift that
 * would produce wrong terrain fails loudly); unknown ADDITIONAL keys are ignored so that the backend can
 * add optional fields without breaking an already deployed viewer.
 */
import { z } from 'zod'

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const num = z.number().finite()

export const gridSchema = z
  .object({
    id: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    resM: z.number().positive(),
    transform: z.tuple([num, num, num, num, num, num]),
    bbox: z.tuple([num, num, num, num]),
    pixelIs: z.literal('area').default('area'),
    northUp: z.boolean().default(true),
  })

export const encodingSchema = z
  .object({
    dtype: z.enum(['uint8', 'uint16', 'float32', 'image/webp', 'image/png', 'application/geo+json']),
    endian: z.enum(['little', 'n/a']).default('little'),
    scale: num.nullish(),
    offset: num.nullish(),
    nodata: num.nullish(),
    description: z.string().nullish(),
  })

const sourceSchema = z
  .object({
    title: z.string(),
    doi: z.string().nullish(),
    url: z.string().nullish(),
    license: z.string(),
    attribution: z.string(),
    retrievedAt: z.string(),
    rawSha256: sha256.nullish(),
  })

const tableSchema = z.object({
  columns: z.array(z.string()),
  lat: num.nullish(),
  lonEast: num.nullish(),
  rows: z.number().int(),
  startUtc: z.string(),
  stepS: num,
})

const tilingSchema = z
  .object({
    tileSize: z.number().int().positive(),
    format: z.literal('webp'),
    levels: z.array(z.record(z.string(), z.number().int())),
    pathTemplate: z.string(),
  })

export const layerSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      'elevation',
      'slope',
      'aspect',
      'roughness',
      'step',
      'hazard',
      'normal',
      'horizon',
      'orthoimage',
      'mineral',
      'vector',
      'sky_view',
      'thermal_inertia',
      'slip_class',
      'sun_table',
      'owlt_table',
    ]),
    /** null for non-gridded tables (sun/OWLT tables) */
    gridId: z.string().nullish(),
    path: z.string(),
    sha256,
    bytes: z.number().int().min(0),
    shape: z.array(z.number().int()).nullish(),
    axes: z.string().nullish(),
    encoding: encodingSchema,
    stats: z
      .object({ min: num.nullish(), max: num.nullish(), mean: num.nullish(), validFraction: num.nullish() })
      .nullish(),
    legend: z
      .array(z.object({ color: z.string(), label: z.string(), pixels: z.number().int().nullish() }).strict())
      .nullish(),
    tiling: tilingSchema.nullish(),
    table: tableSchema.nullish(),
    notes: z.string().nullish(),
    origin: z.enum(['observed', 'derived', 'simulated']),
    source: sourceSchema,
    validation: z
      .object({ coverage: z.number().min(0).max(1), alignRmseM: num.nullish(), method: z.string() })
      .nullish(),
  })

export const manifestSchema = z
  .object({
    schemaVersion: z.string(),
    datasetId: z.string(),
    version: z.string(),
    contentHash: sha256,
    generatedAt: z.string(),
    pipeline: z
      .object({ gitCommit: z.string().nullable(), paramsHash: sha256, tools: z.record(z.string(), z.string()) }),
    crs: z
      .object({
        geographic: z.string(),
        sourceProj4: z.string(),
        localProj4: z.string(),
        localWkt2: z.string(),
        verticalDatum: z.string(),
        center: z.object({ lon: num, lat: num }).strict(),
        localOrigin: z.string(),
      }),
    grid: gridSchema,
    grids: z.record(z.string(), gridSchema),
    bboxLonLat: z.tuple([num, num, num, num]),
    layers: z.array(layerSchema),
    extras: z.record(z.string(), z.string()).nullish(),
  })
  .superRefine((m, ctx) => {
    for (const l of m.layers) {
      if (l.gridId != null && !(l.gridId in m.grids)) {
        ctx.addIssue({ code: 'custom', message: `layer ${l.id}: gridId ${l.gridId} not in grids` })
      }
    }
  })

export type Manifest = z.infer<typeof manifestSchema>
export type Grid = z.infer<typeof gridSchema>
export type Layer = z.infer<typeof layerSchema>

export function parseManifest(json: unknown): Manifest {
  const r = manifestSchema.safeParse(json)
  if (!r.success) {
    const first = r.error.issues[0]
    throw new Error(`Invalid manifest: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim())
  }
  return r.data
}
