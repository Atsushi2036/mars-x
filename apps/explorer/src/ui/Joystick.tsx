import { useRef, useState } from 'react'
import { cameraRig, useCamera } from '@/store/camera'

const RADIUS = 52

/** Virtual joystick for touch devices (first-person mode). Writes -1..1 into `cameraRig.joystick`. */
export function Joystick() {
  const mode = useCamera((s) => s.mode)
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const active = useRef<number | null>(null)

  if (mode !== 'fpv') return null

  const update = (clientX: number, clientY: number) => {
    const r = base.current?.getBoundingClientRect()
    if (!r) return
    let dx = clientX - (r.left + r.width / 2)
    let dy = clientY - (r.top + r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS
      dy = (dy / len) * RADIUS
    }
    setKnob({ x: dx, y: dy })
    cameraRig.joystick.x = dx / RADIUS
    cameraRig.joystick.y = -dy / RADIUS
    cameraRig.sprint = len > RADIUS * 1.15
  }
  const reset = () => {
    active.current = null
    setKnob({ x: 0, y: 0 })
    cameraRig.joystick.x = 0
    cameraRig.joystick.y = 0
    cameraRig.sprint = false
  }

  return (
    <div
      ref={base}
      role="application"
      aria-label="Movement stick"
      className="pointer-events-auto absolute bottom-28 left-5 z-20 size-[132px] touch-none select-none rounded-full border border-border bg-card/70 backdrop-blur-sm [@media(hover:hover)_and_(pointer:fine)]:hidden md:bottom-14"
      onPointerDown={(e) => {
        active.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e.clientX, e.clientY)}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <div
        className="absolute left-1/2 top-1/2 size-14 rounded-full border border-primary/60 bg-primary/25 shadow-md"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  )
}
