import { Sparkles } from '@/ui/icons'
import { Button } from '@/components/ui/button'
import { startGuidedMission } from './api'
import { useTour } from './store'

/** Topbar entry point of the guided mission. */
export default function GuidedButton() {
  const active = useTour((s) => s.active)
  return (
    <Button aria-pressed={active} onClick={startGuidedMission} className="h-10 gap-2 px-3.5 text-sm font-semibold">
      <Sparkles className="size-5" aria-hidden="true" />
      <span className="hidden sm:inline">Guided tour</span>
      <span className="sm:hidden">Tour</span>
    </Button>
  )
}
