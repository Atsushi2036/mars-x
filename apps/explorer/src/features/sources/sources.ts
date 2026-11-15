import type { Layer, Manifest } from '@/core/data/manifest'
import { toProvenance, type Provenance } from '../shared/provenance'

/** One credited source, merged from every manifest layer that cites it. Texts come from the manifest, never from this file. */
export interface SourceGroup {
  key: string
  title: string
  attribution: string
  license: string
  doi: string | null
  url: string | null
  /** strongest origin among its layers: an observed product stays "measured" even if derived layers cite it too */
  provenance: Provenance
  layers: string[]
  /** finest grid resolution (metres per pixel) of the layers that cite it; null when the layers have no grid */
  resM: number | null
}

/** Derived layers cite their parent product as "<title> -> derived by the marsx pipeline"; credit the product itself. */
export function baseTitle(title: string): string {
  return title.replace(/\s*->\s*derived by the marsx pipeline\s*$/i, '').trim()
}

const RANK: Record<Provenance, number> = { measured: 3, derived: 2, modeled: 1, assumption: 0 }

export function groupSources(m: Pick<Manifest, 'layers' | 'grids'>): SourceGroup[] {
  const out = new Map<string, SourceGroup>()
  for (const l of m.layers) {
    const title = baseTitle(l.source.title)
    const key = `${title}|${l.source.doi ?? ''}`
    const res = l.gridId ? (m.grids[l.gridId]?.resM ?? null) : null
    const prov = toProvenance(l.origin)
    const g = out.get(key)
    if (!g) {
      out.set(key, { key, title, attribution: l.source.attribution, license: l.source.license, doi: l.source.doi ?? null, url: l.source.url ?? null, provenance: prov, layers: [l.id], resM: res })
      continue
    }
    g.layers.push(l.id)
    if (RANK[prov] > RANK[g.provenance]) g.provenance = prov
    if (res !== null) g.resM = g.resM === null ? res : Math.min(g.resM, res)
  }
  return [...out.values()]
}

export function layerKinds(layers: readonly Layer[], ids: readonly string[]): string {
  const kinds = new Set(ids.map((id) => layers.find((l) => l.id === id)?.kind).filter(Boolean) as string[])
  return [...kinds].join(', ')
}

/** https link for a DOI, or null if it does not look like one. Only https URLs are ever rendered as links. */
export function doiUrl(doi: string | null | undefined): string | null {
  if (!doi) return null
  const d = doi.replace(/^doi:/i, '').trim()
  return /^10\.\d{4,9}\/\S+$/.test(d) ? `https://doi.org/${d}` : null
}

export function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

export function fmtRes(resM: number | null): string {
  if (resM === null) return 'No data'
  if (resM < 1) return `${(resM * 100).toFixed(0)} cm/px`
  return `${resM} m/px`
}
