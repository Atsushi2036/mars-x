/**
 * Slot registry: lets feature modules (src/features/*) mount UI and scene content in the shell without
 * the shell importing them. A feature adds `src/features/<name>/register.ts(x)` that calls `registerSlot`
 * (main.tsx loads every `register.*` eagerly; register lazy components so features stay out of the initial bundle).
 *
 *   registerSlot({ id: 'lab.panel', slot: 'panel:lab', mode: 'replace', component: LabPanel })
 *
 * Slots:
 *   panel:explore | panel:layers | panel:mission | panel:lab | panel:data   inspector body of that mode
 *        mode 'append' (default) renders after the built-in content, 'replace' renders instead of it
 *   topbar:right                                                            small controls in the topbar
 *   scene                                                                   react-three-fiber children inside the Canvas
 *   overlay                                                                 absolutely positioned HTML over the canvas (z-20)
 */
import { Suspense, type ComponentType, type ReactNode } from 'react'
import { create } from 'zustand'

export type SlotId =
  | 'panel:explore'
  | 'panel:layers'
  | 'panel:mission'
  | 'panel:lab'
  | 'panel:data'
  | 'topbar:right'
  | 'scene'
  | 'overlay'

export interface SlotEntry {
  /** unique id; registering the same id again replaces the previous entry */
  id: string
  slot: SlotId
  component: ComponentType
  /** lower renders first (default 100) */
  order?: number
  /** panels only: replace the built-in content instead of appending to it */
  mode?: 'append' | 'replace'
}

interface SlotStore {
  entries: SlotEntry[]
}

const useSlotStore = create<SlotStore>(() => ({ entries: [] }))

/** Registers (or replaces) an entry; returns an unregister function. */
export function registerSlot(entry: SlotEntry): () => void {
  useSlotStore.setState((s) => ({ entries: [...s.entries.filter((e) => e.id !== entry.id), entry] }))
  return () => useSlotStore.setState((s) => ({ entries: s.entries.filter((e) => e.id !== entry.id) }))
}

export function useSlotEntries(slot: SlotId): SlotEntry[] {
  const all = useSlotStore((s) => s.entries)
  return all.filter((e) => e.slot === slot).sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/** Renders every entry of a slot (each inside its own Suspense boundary so a lazy feature cannot blank the shell). */
export function Slot({ name, fallback = null }: { name: SlotId; fallback?: ReactNode }) {
  const entries = useSlotEntries(name)
  return (
    <>
      {entries.map((e) => (
        <Suspense key={e.id} fallback={fallback}>
          <e.component />
        </Suspense>
      ))}
    </>
  )
}

/** Panel body helper: built-in content + registered extras, or the replacement when one is registered. */
export function PanelSlot({ name, builtin }: { name: SlotId; builtin: ReactNode }) {
  const entries = useSlotEntries(name)
  const replacing = entries.some((e) => e.mode === 'replace')
  return (
    <>
      {!replacing && builtin}
      {entries.map((e) => (
        <Suspense key={e.id} fallback={null}>
          <e.component />
        </Suspense>
      ))}
    </>
  )
}
