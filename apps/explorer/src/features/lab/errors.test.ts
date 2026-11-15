import { describe, expect, it } from 'vitest'
import { explainPolicyError, explainRunError } from './errors'

describe('policy errors in plain language', () => {
  it('splits the validator list and explains banned operators', () => {
    const e = explainPolicyError('Model rejected: operator Loop is not allowed; the model must have exactly one input named "obs"')
    expect(e.headline).toContain('policy/1')
    expect(e.problems).toHaveLength(2)
    expect(e.problems[0]).toContain('Loop')
    expect(e.problems[0]).toContain('unbounded')
    expect(e.fix).toContain('[batch, 505]')
  })
  it('says a non-ONNX file is not an ONNX model', () => {
    expect(explainPolicyError('Model rejected: unsupported wire type 4').problems[0]).toContain('not an ONNX file')
  })
  it('handles size, empty and timeout', () => {
    expect(explainPolicyError('The model is larger than 20 MB').headline).toContain('too large')
    expect(explainPolicyError('The model file is empty').headline).toContain('empty')
    expect(explainPolicyError('Timed out while loading the model').headline).toContain('stopped')
  })
  it('never loses an unknown message', () => {
    expect(explainPolicyError('boom').problems).toEqual(['boom'])
  })
})

describe('run errors in plain language', () => {
  it('recognises schema failures without echoing file content', () => {
    const e = explainRunError('Not a valid MARS-X run/1 file (invalid_type at episodes.0.steps)')
    expect(e.headline).toContain('run/1')
    expect(e.fix).toContain('marsx bench run')
  })
  it('recognises non-JSON and size', () => {
    expect(explainRunError('The file is not valid UTF-8 JSON').headline).toContain('not a JSON')
    expect(explainRunError('The file is larger than 10 MB').headline).toContain('too large')
  })
})
