/**
 * Energy models ported from python/src/marsx/conditions/energy.py (same constants, same formulas).
 * Provenance lives with the Python PARAMS table; these are the numbers the env-lite needs.
 */
const BTU_PER_H_TO_W = 0.29307107
const round1 = (x: number) => Math.round(x * 10) / 10

export const ENERGY = {
  rtgBolW: 110,
  batteryCount: 2,
  batteryAhEach: 43,
  batteryVoltage: 28,
  roverMassKg: 1025,
  roverSpeed: 0.042,
  rollingResistance: 0.15,
  driveEfficiency: 0.5,
  baseLoadW: 60,
  metRateLowW: round1(780 * BTU_PER_H_TO_W),
  metRateHighW: round1(1200 * BTU_PER_H_TO_W),
  metSlopeFullDeg: 20,
  astronautSpeed: 1,
  evaDurationH: 4,
} as const

export const batteryCapacityWh = () => ENERGY.batteryCount * ENERGY.batteryAhEach * ENERGY.batteryVoltage
export const evaConsumablesWh = () => ENERGY.evaDurationH * ENERGY.metRateHighW
export const rtgPowerW = (years: number) => ENERGY.rtgBolW * (1 - 0.025) ** years

/** Rover electrical power while driving up (+) / down (-) a slope, traction clipped at 0. */
export function roverDrivePowerW(slopeDeg: number, gravity: number): number {
  const th = (slopeDeg * Math.PI) / 180
  const traction =
    (ENERGY.roverMassKg * gravity * ENERGY.roverSpeed * (ENERGY.rollingResistance * Math.cos(th) + Math.sin(th))) / ENERGY.driveEfficiency
  return Math.max(traction, 0) + ENERGY.baseLoadW
}

export function roverDriveEnergyWh(distanceM: number, slopeDeg: number, gravity: number, slip = 0): number {
  const s = Math.min(Math.max(slip, 0), 0.99)
  const tS = distanceM / ENERGY.roverSpeed / (1 - s)
  return (roverDrivePowerW(slopeDeg, gravity) * tS) / 3600
}

export function astronautMetabolicW(slopeDeg: number): number {
  const frac = Math.min(Math.max(slopeDeg / ENERGY.metSlopeFullDeg, 0), 1)
  return ENERGY.metRateLowW + (ENERGY.metRateHighW - ENERGY.metRateLowW) * frac
}

export function astronautStepEnergyWh(distanceM: number, slopeDeg: number): number {
  return (astronautMetabolicW(slopeDeg) * (distanceM / ENERGY.astronautSpeed)) / 3600
}
