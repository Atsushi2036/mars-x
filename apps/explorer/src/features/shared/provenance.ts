/**
 * Provenance vocabulary shown next to every number (PO: measured / derived / modeled / assumption).
 * Aligned with the manifest `origin` (observed | derived | simulated) and the python `Param.provenance`
 * (source | computed | assumption).
 */
export type Provenance = 'measured' | 'derived' | 'modeled' | 'assumption'

export const PROVENANCE_META: Record<Provenance, { label: string; hint: string }> = {
  measured: { label: 'measured', hint: 'Recorded by an instrument on Mars or in orbit.' },
  derived: { label: 'derived', hint: 'Computed from measurements or taken from a cited publication.' },
  modeled: { label: 'modeled', hint: 'Output of a published model or algorithm, not an observation.' },
  assumption: { label: 'assumption', hint: 'Team assumption with no primary source. Editable and flagged in every report.' },
}

/** Python `Param.provenance` and manifest `origin` to the UI vocabulary. Unknown values fall back to the most cautious label. */
export function toProvenance(raw: string | null | undefined): Provenance {
  switch (raw) {
    case 'measured':
    case 'observed':
      return 'measured'
    case 'derived':
    case 'computed':
    case 'source':
      return 'derived'
    case 'modeled':
    case 'simulated':
      return 'modeled'
    default:
      return 'assumption'
  }
}
