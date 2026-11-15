import { z } from 'zod'
import type { WaypointInfo } from '@/store/app'

/**
 * Parsers for the Perseverance traverse and waypoints the pipeline clips to the window
 * (traverse.geojson, waypoints.geojson). Local coordinates are metres: x east, y north, z elevation;
 * the 3D world uses z = -north.
 */
const num = z.number().finite()

const traverseFile = z.object({
  features: z.array(
    z.object({
      properties: z.object({ sol: z.number().int().nullish(), local: z.array(z.tuple([num, num, num])).min(1) }),
    }),
  ),
})

const waypointFile = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        sol: z.number().int(),
        site: z.number().int(),
        drive: z.number().int(),
        pitch: num,
        roll: num,
        yaw: num,
        tilt: num,
        distTotalM: num,
        local: z.tuple([num, num, num]),
      }),
    }),
  ),
})

export interface TraverseData {
  /** one polyline per drive, world (x, z) */
  lines: Array<{ sol: number | null; xz: Float32Array }>
  totalPoints: number
}

export function parseTraverse(json: unknown): TraverseData {
  const f = traverseFile.parse(json)
  const lines = f.features.map((ft) => {
    const xz = new Float32Array(ft.properties.local.length * 2)
    ft.properties.local.forEach((p, i) => {
      xz[2 * i] = p[0]
      xz[2 * i + 1] = -p[1]
    })
    return { sol: ft.properties.sol ?? null, xz }
  })
  return { lines, totalPoints: lines.reduce((n, l) => n + l.xz.length / 2, 0) }
}

export function parseWaypoints(json: unknown): WaypointInfo[] {
  return waypointFile.parse(json).features.map((ft) => {
    const p = ft.properties
    return {
      sol: p.sol,
      site: p.site,
      drive: p.drive,
      tiltDeg: p.tilt,
      pitchDeg: p.pitch,
      rollDeg: p.roll,
      yawDeg: p.yaw,
      distTotalM: p.distTotalM,
      x: p.local[0],
      z: -p.local[1],
    }
  })
}
