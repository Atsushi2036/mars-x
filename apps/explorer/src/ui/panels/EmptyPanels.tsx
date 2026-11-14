import { FlaskConical, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

function Empty({ icon: Icon, title, body, cta, why }: { icon: LucideIcon; title: string; body: string; cta: string; why: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-surface text-primary">
        <Icon className="size-6" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-5 text-muted-foreground">{body}</p>
      </div>
      <Button disabled className="h-10 md:h-8" aria-describedby="empty-why">
        {cta}
      </Button>
      <p id="empty-why" className="text-xs text-muted-foreground">
        {why}
      </p>
    </div>
  )
}

/** Slot for the model lab (owned by the AI slice). */
export function LabPanel() {
  return (
    <Empty
      icon={FlaskConical}
      title="No model loaded"
      body="Bring your own navigation policy, run it on the same terrain and compare it with A*."
      cta="Load model"
      why="Disabled: the lab arrives in a later slice."
    />
  )
}
