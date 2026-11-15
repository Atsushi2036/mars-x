import { useState } from 'react'
import { Brain, Upload } from '@/ui/icons'
import { PanelSection, Segmented } from '@/ui/kit'
import { ByoModel } from './ByoModel'
import { QLab } from './QLab'

type Tab = 'train' | 'byo'

export function LabPanel() {
  const [tab, setTab] = useState<Tab>('train')
  return (
    <div>
      <PanelSection>
        <Segmented<Tab>
          label="Lab view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'train', label: 'Train in the browser', sub: 'Q-learning, live', icon: Brain },
            { value: 'byo', label: 'Bring your model', sub: '.onnx or run.json', icon: Upload },
          ]}
        />
      </PanelSection>
      {tab === 'train' ? <QLab /> : <ByoModel />}
    </div>
  )
}
