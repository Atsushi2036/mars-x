import { FileUp, LoaderCircle } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * File drop target: drag a file onto it, or press the button. The (visually hidden) input is only the
 * browser's file chooser; the control the user sees and focuses is the button.
 */
export function DropZone({
  accept,
  title,
  hint,
  busy,
  onFile,
  disabledReason,
}: {
  accept: string
  title: string
  hint: string
  busy?: boolean
  onFile: (f: File) => void
  disabledReason?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const hintId = useId()
  const disabled = !!disabledReason || !!busy
  const pick = (f: File | undefined) => {
    if (f && !disabled) onFile(f)
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        pick(e.dataTransfer.files[0])
      }}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors',
        over ? 'border-primary bg-primary/10' : 'border-input bg-surface/50',
        disabled && 'opacity-70',
      )}
    >
      <div className="grid size-9 place-items-center rounded-lg bg-surface text-primary">
        {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <FileUp className="size-5" strokeWidth={1.75} aria-hidden="true" />}
      </div>
      <p className="text-sm font-medium">{busy ? 'Checking the file…' : title}</p>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => input.current?.click()}
        className="inline-flex h-10 items-center rounded-md border border-input bg-card px-3 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none md:h-8"
      >
        Choose a file
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={title}
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <p id={hintId} className="text-[11px] leading-4 text-muted-foreground">
        {disabledReason ?? hint}
      </p>
    </div>
  )
}
