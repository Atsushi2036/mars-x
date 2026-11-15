import type { ReactNode } from 'react'
import { Metric } from '../kit'
import { PanelSection } from '../kit'

/** Back-compat wrapper over the kit's PanelSection (title + one-line caption). New code imports from '@/ui/kit'. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <PanelSection title={title} caption={hint}>
      {children}
    </PanelSection>
  )
}

/** Back-compat wrapper over Metric. */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return <Metric label={label} value={value} mono />
}
