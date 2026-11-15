import { z } from 'zod'
import { NO_DATA, fmtNum } from '../shared/fmt'

/** Subset of `validation_report.json` written by the pipeline (python/src/marsx/pipeline). Extra keys are ignored. */
const stat = z.object({ n: z.number().int(), pearson: z.number(), mae: z.number(), bias: z.number(), rmse: z.number() })

export const validationSchema = z.object({
  datasetId: z.string(),
  generatedAt: z.string(),
  alignmentDemOrtho: z.object({
    method: z.string(),
    globalShiftPx: z.object({ magnitude: z.number() }),
    shiftPxP95: z.number(),
    validPatches: z.number().int(),
    patches: z.number().int(),
    globalCorrelation: z.number(),
    pixelSizeM: z.number(),
  }),
  demHeightAtWaypoints_vs_published_elevGeoid: stat,
  slopeVsRoverTilt: z.object({
    note: z.string(),
    tiltDeg_vs_demSlope1m: stat,
    tiltDeg_vs_demSlopeSmoothed1p5m: stat,
  }),
  notes: z.array(z.string()).default([]),
})
export type ValidationReport = z.infer<typeof validationSchema>

export interface Headline {
  id: 'height' | 'slope' | 'align'
  title: string
  /** the number to show large */
  big: string
  /** what the big number is */
  bigLabel: string
  lines: Array<[label: string, value: string]>
  caveat: string
}

const r = (v: number, d: number) => fmtNum(v, d)
/** Truncates instead of rounding, so r = 0.9999991 reads 0.99999 and never rounds up to a perfect 1. */
const trunc = (v: number, d: number) => (Math.floor(v * 10 ** d) / 10 ** d).toFixed(d)

/** The three headline checks. Every figure is read from the report; nothing is typed in by hand. */
export function headlines(rep: ValidationReport): Headline[] {
  const h = rep.demHeightAtWaypoints_vs_published_elevGeoid
  const s = rep.slopeVsRoverTilt.tiltDeg_vs_demSlope1m
  const ss = rep.slopeVsRoverTilt.tiltDeg_vs_demSlopeSmoothed1p5m
  const a = rep.alignmentDemOrtho
  return [
    {
      id: 'height',
      title: 'Terrain height vs the rover',
      big: `r = ${trunc(h.pearson, 5)}`,
      bigLabel: `DEM height against Perseverance's own elevation at ${h.n} waypoints`,
      lines: [
        ['Mean abs. error', `${r(h.mae * 100, 1)} cm`],
        ['Bias', `${r(h.bias * 100, 1)} cm`],
        ['RMSE', `${r(h.rmse * 100, 1)} cm`],
      ],
      caveat: "The rover's published elevations may themselves be tied to orbital maps, so read this as a georeferencing and datum check more than an independent test of the terrain.",
    },
    {
      id: 'slope',
      title: 'Slope vs measured tilt',
      big: `r = ${r(s.pearson, 2)}`,
      bigLabel: `DEM slope against the rover's measured tilt at ${s.n} waypoints (${r(ss.pearson, 2)} with the DEM smoothed to the rover's 1.5 m scale)`,
      lines: [
        ['Mean abs. error', `${r(s.mae, 1)}° (${r(ss.mae, 1)}° smoothed)`],
        ['Bias', `${r(s.bias, 1)}°`],
        ['RMSE', `${r(s.rmse, 1)}°`],
      ],
      caveat: 'Statistical agreement, not per point: the DEM is 1 m orbital data and the rover wheelbase is about 2.7 m.',
    },
    {
      id: 'align',
      title: 'Elevation vs image alignment',
      big: `${r(a.globalShiftPx.magnitude, 2)} px`,
      bigLabel: `Global offset between the elevation model and the orthoimage (1 px = ${a.pixelSizeM} m)`,
      lines: [
        ['Patches measured', `${a.validPatches} of ${a.patches}`],
        ['95th percentile shift', `${r(a.shiftPxP95, 2)} px`],
        ['Hillshade correlation', r(a.globalCorrelation, 2)],
      ],
      caveat: 'Measured by cross-correlating a hillshade with the image. The correlation is modest, so read it as a bound, not a precision.',
    },
  ]
}

export const REFERENCE_NOTE = "Perseverance's path was planned by humans with science goals. It is a reference, not ground truth."

export const noValidation = NO_DATA
