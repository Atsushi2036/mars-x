import { EmptyState } from '../kit'

/** Fallback body of "Test your AI" while the lab module loads (it replaces this panel when registered). */
export function LabPanel() {
  return <EmptyState art="model" title="No model loaded" line="Train in the browser or drop your own model, then compare it with A*." />
}
