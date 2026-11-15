import { create } from 'zustand'
import { useByo, type ByoState } from '@/features/shared/byo-store'

/**
 * Keeps the ONNX file the user dropped in Test your AI, so Watch can run it. The lab host owns the policy worker and only mirrors
 * the file name into the store, so this wraps `actions.loadPolicy` / `unloadPolicy` once (no change to the lab code) and remembers
 * the File. The bytes stay in memory only and go to the policy worker through the same validated PolicyClient path.
 */
export const useUserModel = create<{ file: File | null; /** set when the file came from the catalog, null for a drop */ catalogId: string | null }>(() => ({ file: null, catalogId: null }))

let pendingCatalog: string | null = null
/** Call right before handing a catalog model to the lab loader, so the file is not mistaken for the user's own. */
export function markCatalogLoad(id: string | null): void {
  pendingCatalog = id
}

const wrapped = new WeakSet<ByoState['actions']>()

function wrap(actions: ByoState['actions']): ByoState['actions'] | null {
  if (wrapped.has(actions)) return null
  const next: ByoState['actions'] = {
    ...actions,
    loadPolicy: (file) => {
      useUserModel.setState({ file, catalogId: pendingCatalog })
      pendingCatalog = null
      actions.loadPolicy(file)
    },
    unloadPolicy: () => {
      useUserModel.setState({ file: null, catalogId: null })
      actions.unloadPolicy()
    },
  }
  wrapped.add(next)
  return next
}

let installed = false
/** Idempotent. Call from any component that needs the user's model. */
export function captureUserModel(): void {
  if (installed) return
  installed = true
  const apply = () => {
    const next = wrap(useByo.getState().actions)
    if (next) useByo.setState({ actions: next })
  }
  apply()
  useByo.subscribe((s, prev) => {
    if (s.actions !== prev.actions) apply()
  })
}
