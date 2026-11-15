/** Turns validator output into plain language: a headline, the specific problems, and what to do about it. */
export interface Explained {
  headline: string
  problems: string[]
  fix: string
}

const PREFIX = /^Model rejected:\s*/i

export function explainPolicyError(message: string): Explained {
  if (PREFIX.test(message)) {
    const problems = message.replace(PREFIX, '').split(/;\s*/).filter(Boolean).map(plainProblem)
    return {
      headline: 'This model does not meet the policy/1 contract, so it was not run.',
      problems,
      fix: 'Export only the obs to logits network (input "obs" float32 [batch, 505], output "logits" float32 [batch, 9]) with opset 17 to 20 and no external data.',
    }
  }
  if (/larger than/i.test(message)) return { headline: 'The model file is too large.', problems: [message], fix: 'Policies are limited to 20 MB. Export just the policy network, not the training checkpoint.' }
  if (/empty/i.test(message)) return { headline: 'The file is empty.', problems: [], fix: 'Choose the .onnx file you exported.' }
  if (/timed out/i.test(message)) return { headline: 'The model took too long and was stopped.', problems: [message], fix: 'The worker was terminated. Try a smaller network.' }
  if (/inference engine/i.test(message)) return { headline: 'The in-browser inference engine could not be loaded.', problems: [message], fix: 'Check your connection and try again.' }
  return { headline: 'The model could not be loaded.', problems: [message], fix: 'Check that the file is an ONNX model that follows the policy/1 contract.' }
}

function plainProblem(p: string): string {
  const op = /^operator (\w+) is not allowed/.exec(p)
  if (op) return `The operator ${op[1]} is not allowed (loops, scans and conditionals can run unbounded).`
  if (/external data/.test(p)) return `${p}. Weights must be stored inside the file.`
  if (/exactly one input named "obs"/.test(p)) return 'The model must have a single input named "obs".'
  if (/domain ".*" is not allowed/.test(p)) return `${p}. Only the standard ONNX operator sets are accepted.`
  if (/opset/.test(p)) return `${p}. Re-export with an opset between 17 and 20.`
  return p
}

export function explainRunError(message: string): Explained {
  if (/larger than/i.test(message)) return { headline: 'The run file is too large.', problems: [message], fix: 'run.json files are limited to 10 MB. Evaluate fewer episodes or drop the trajectories you do not need.' }
  if (/empty/i.test(message)) return { headline: 'The file is empty.', problems: [], fix: 'Choose the run.json written by `marsx bench run`.' }
  if (/not valid utf-8 json/i.test(message)) return { headline: 'This is not a JSON file.', problems: [message], fix: 'Choose the run.json written by the MARS-X SDK.' }
  if (/not a valid mars-x run/i.test(message)) return { headline: 'This is not a MARS-X run/1 file.', problems: [message], fix: 'Produce it with `marsx bench run` or `marsx.evaluate(...)`; hand-edited files are rejected.' }
  if (/trajectory must have steps/i.test(message)) return { headline: 'A trajectory does not follow the traj/1 convention.', problems: [message], fix: 'Update the SDK and run the benchmark again.' }
  if (/timed out/i.test(message)) return { headline: 'Reading the file took too long.', problems: [message], fix: 'Try again with a smaller file.' }
  return { headline: 'The run file could not be read.', problems: [message], fix: 'Check that it is an unmodified run.json from the SDK.' }
}
