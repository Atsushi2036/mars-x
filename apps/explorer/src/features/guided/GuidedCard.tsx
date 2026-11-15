import { ChevronLeft, ChevronRight, Compass, FileText, Pause, Play, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useDay } from '@/store/day'
import { useScenario } from '../scenario/store'
import { openScorecard } from '../replay/scorecard-ui'
import { useByo } from '../shared/byo-store'
import { scrollInspectorTo } from './dom'
import { keyAction, tourRequested } from './machine'
import { STEP_COUNT } from './step-count'
import { SCENARIO, STEPS, type ActionId } from './steps'
import { useTour } from './store'

function StepAction({ id, label }: { id: ActionId; label: string }) {
  const scenarioId = useScenario((s) => s.scenarioId)
  const selectScenario = useScenario((s) => s.selectScenario)
  const playing = useDay((s) => s.playing)
  const setPlaying = useDay((s) => s.setPlaying)
  const run = useByo((s) => s.run)
  const missing = useTour((s) => s.exampleMissing)
  const btn = 'h-9 px-2.5 text-xs md:h-7'

  if (id === 'clear-sol' || id === 'storm-sol') {
    const target = id === 'clear-sol' ? SCENARIO.clear : SCENARIO.storm
    return (
      <Button variant={scenarioId === target ? 'secondary' : 'outline'} aria-pressed={scenarioId === target} className={btn} onClick={() => selectScenario(target)}>
        {label}
      </Button>
    )
  }
  if (id === 'play-day') {
    return (
      <Button variant="outline" aria-pressed={playing} className={btn} onClick={() => setPlaying(!playing)}>
        {playing ? <Pause /> : <Play />}
        {playing ? 'Pause' : label}
      </Button>
    )
  }
  if (id === 'toggle-panel') return <PanelToggle label={label} btn={btn} />
  const ready = !!run.result && !run.loading
  return (
    <Button variant={ready ? 'default' : 'outline'} disabled={!ready} className={btn} onClick={openScorecard}>
      <FileText />
      {ready ? label : missing ? 'Example run not published' : run.error ? 'Example run failed to load' : 'Loading example run…'}
    </Button>
  )
}

let seq = 0

/** Phones only: the sheet is closed while the tour shows the route; this opens it on the numbers and closes it again. */
function PanelToggle({ label, btn }: { label: string; btn: string }) {
  const open = useApp((s) => s.inspectorOpen)
  return (
    <Button
      variant="outline"
      aria-pressed={open}
      className={cn(btn, 'md:hidden')}
      onClick={() => {
        const app = useApp.getState()
        app.setInspectorOpen(!open)
        if (!open) void scrollInspectorTo('EVA budget')
      }}
    >
      {open ? 'Hide' : 'Show'} {label.toLowerCase()}
    </Button>
  )
}

/** Floating, non-modal card of the guided mission. Also owns the tour's side effects (step setup, keyboard, ?tour=1). */
export default function GuidedCard() {
  const active = useTour((s) => s.active)
  const index = useTour((s) => s.index)
  const dispatch = useTour((s) => s.dispatch)
  const ready = useApp((s) => s.progress.ready >= 1)
  const heading = useRef<HTMLHeadingElement>(null)

  // ?tour=1 opens the tour as soon as the scene is ready (30 s video, shared links)
  const auto = useRef(false)
  useEffect(() => {
    if (ready && !auto.current && tourRequested(window.location.search)) {
      auto.current = true
      dispatch({ type: 'start' })
    }
  }, [ready, dispatch])

  // while the tour runs the 10 s tips card stays closed
  useEffect(() => {
    if (!active) return
    useApp.getState().setOnboardingOpen(false)
    return useApp.subscribe((s) => {
      if (s.onboardingOpen) useApp.getState().setOnboardingOpen(false)
    })
  }, [active])

  // each step puts the app in its deterministic state; a stale async setup is ignored once the user moved on
  useEffect(() => {
    if (!active) return
    const mine = ++seq
    const focusHeading = () => heading.current?.focus({ preventScroll: true })
    focusHeading()
    void STEPS[index]!
      .enter(() => seq === mine)
      .catch((e) => console.error('Guided mission step failed', e))
      .finally(() => {
        // a step may have clicked a control (which takes focus and would swallow the arrow keys): bring focus back to the card
        const a = document.activeElement
        if (seq === mine && (!a || a === document.body || a.getAttribute('role') === 'radio')) focusHeading()
      })
    return () => {
      seq++
    }
  }, [active, index])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      const t = e.target instanceof HTMLElement ? e.target : null
      const a = keyAction({
        key: e.key,
        target: t ? { tagName: t.tagName, role: t.getAttribute('role'), isContentEditable: t.isContentEditable } : null,
        dialogOpen: !!document.querySelector('[role="dialog"]'),
      })
      if (a) {
        e.preventDefault()
        dispatch({ type: a })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, dispatch])

  if (!active) return null
  const step = STEPS[index]!
  const last = index === STEP_COUNT - 1
  return (
    <section
      role="region"
      aria-label="Guided mission"
      data-cover="top"
      className="pointer-events-auto glass absolute inset-x-3 top-[calc(var(--cover-top)+8px)] z-40 rounded-2xl p-3 text-card-foreground motion-safe:animate-in motion-safe:fade-in-0 md:inset-x-auto md:left-1/2 md:top-[calc(var(--cover-top)+12px)] md:w-[25rem] md:-translate-x-1/2 md:p-4"
    >
      <div className="flex items-center gap-2">
        <Compass className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
          Guided mission, step {index + 1} of {STEP_COUNT}
        </p>
        <Button variant="ghost" size="icon" aria-label="Exit guided mission" className="-mr-1.5 -mt-1.5 size-9 md:size-7" onClick={() => dispatch({ type: 'exit' })}>
          <X />
        </Button>
      </div>

      <div aria-live="polite" className="mt-1 space-y-1.5">
        <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold leading-5 outline-none md:text-[0.95rem]">
          {step.title}
        </h2>
        <p className="text-xs leading-[1.1rem] text-foreground/90 md:text-[13px] md:leading-5">{step.body}</p>
        {step.notes && (
          <ul className="space-y-1 text-[11px] leading-4 text-muted-foreground md:text-xs md:leading-[1.1rem]">
            {step.notes.map((n) => (
              <li key={n} className="flex gap-1.5">
                <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {step.actions && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {step.actions.map((a) => (
            <StepAction key={a.id} {...a} />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <ol className="flex min-w-0 flex-1 items-center gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <li key={s.id} className={cn('h-1 flex-1 rounded-full', i === index ? 'bg-primary' : i < index ? 'bg-primary/40' : 'bg-border')} />
          ))}
        </ol>
        <Button variant="ghost" className="h-9 px-2 md:h-8" disabled={index === 0} onClick={() => dispatch({ type: 'back' })}>
          <ChevronLeft /> Back
        </Button>
        <Button className="h-9 px-3 md:h-8" onClick={() => dispatch({ type: 'next' })}>
          {last ? 'Finish' : 'Next'} {!last && <ChevronRight />}
        </Button>
      </div>
      <p className="sr-only">Use the left and right arrow keys to move between steps and Escape to exit.</p>
    </section>
  )
}
