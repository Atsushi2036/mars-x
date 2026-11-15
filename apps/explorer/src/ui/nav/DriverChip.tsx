import { useApp } from '@/store/app'
import { ICON, Info } from '@/ui/icons'

/**
 * Honest label of what moves the agent in Watch. Today a route Watch replays the A* plan: a classic search, not AI.
 * The link leads to Test your AI, where a policy can be trained or dropped in.
 */
export function DriverChip({ label = 'Driven by: A* planner (classic, not AI)', className = '' }: { label?: string; className?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className}`}>
      <Info size={ICON.chip} strokeWidth={ICON.stroke} aria-hidden="true" className="shrink-0" />
      <span>{label}</span>
      <button
        type="button"
        onClick={() => useApp.getState().setMode('lab')}
        className="shrink-0 rounded font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Test your AI
      </button>
    </p>
  )
}
