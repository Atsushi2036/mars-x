import { useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ByoModel } from './ByoModel'
import { QLab } from './QLab'

export function LabPanel() {
  const [tab, setTab] = useState<'train' | 'byo'>('train')
  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v as 'train' | 'byo')} variant="outline" spacing={0} className="w-full" aria-label="Lab view">
          <ToggleGroupItem value="train" className="h-10 flex-1 text-xs md:h-8">
            Train Q-learning
          </ToggleGroupItem>
          <ToggleGroupItem value="byo" className="h-10 flex-1 text-xs md:h-8">
            Bring your model
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {tab === 'train' ? <QLab /> : <ByoModel />}
    </div>
  )
}
