import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startGuidedMission } from './api'
import { useTour } from './store'

/** Topbar entry point of the guided mission. */
export default function GuidedButton() {
  const active = useTour((s) => s.active)
  return (
    <Button variant="outline" size="sm" aria-pressed={active} onClick={startGuidedMission} className="h-9 gap-1.5 px-2.5 md:h-8">
      <Compass className="text-primary" aria-hidden="true" />
      <span className="hidden sm:inline">Guided mission</span>
      <span className="sm:hidden">Tour</span>
    </Button>
  )
}
