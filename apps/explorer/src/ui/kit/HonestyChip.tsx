import { ShieldCheck } from '../icons'
import { Chip } from './Chip'
import { Learn } from './Learn'

/** "Simulation only · necessary, not sufficient", with the long explanation behind a popover. */
export function HonestyChip() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <Chip tone="warning" icon={ShieldCheck}>
        Simulation only · necessary, not sufficient
      </Chip>
      <Learn title="What a pass means">
        <p>Passing L1 to L3 shows the policy survives this simulated terrain and these conditions. It is a first filter before field trials, not a safety proof.</p>
        <p>It does not cover wheel-soil interaction, hardware faults, flight software or sensor effects beyond the listed ones.</p>
      </Learn>
    </span>
  )
}
