import { describe, expect, it } from 'vitest'
import type { Decision } from '@haazir/ai-core'
import { evaluateTurn, normalise } from '../score'

const trace = {
  intent: 'fee_query',
  language: 'hinglish',
  confidence: 0.9,
  retrievedChunkIds: [],
  toolCalls: [],
  model: 'm',
  promptVersion: 'v',
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  guardrailFlags: [],
}
const reply = (body: string): Decision => ({
  kind: 'reply',
  content: { kind: 'text', body },
  trace,
  actions: [],
  flowState: null,
})
const corpus = '{"total_fee":"₹4,500"} Station Road, Sikar 332001'

describe('evaluateTurn', () => {
  it('matches numbers however they are written', () => {
    expect(normalise('₹4,500 और ४५००')).toBe('₹4500 और 4500')
    expect(
      evaluateTurn({ must_include: ['4500'] }, reply('Fees *₹4,500* hai'), 'fees?', corpus)
        .failures,
    ).toEqual([])
  })

  it('flags any number that is in neither the data nor the question, independently of the guardrail', () => {
    const result = evaluateTurn({}, reply('Fees ₹4,500 hai, 10% off bhi hai'), 'fees?', corpus)
    expect(result.inventedNumbers).toEqual(['10'])
    expect(result.failures).toContain('invented number: 10')
  })

  it("allows the person's own numbers", () => {
    expect(
      evaluateTurn({}, reply('Haan, 3 dost ek saath aa sakte hain'), 'hum 3 dost hain', corpus)
        .inventedNumbers,
    ).toEqual([])
  })

  it('checks intent lists, language, script, handoff and forbidden text', () => {
    const r = evaluateTurn(
      {
        intent: ['course_info', 'batch_timing'],
        language: 'hi',
        script: 'devanagari',
        handoff: true,
        must_not_include: ['hai'],
      },
      reply('Fees ₹4,500 hai'),
      'q',
      corpus,
    )
    expect(r.failures).toEqual([
      'intent: wanted course_info|batch_timing, got fee_query',
      'language: wanted hi, got hinglish',
      'script: wanted devanagari, got latin',
      'handoff: wanted a handoff, got reply',
      'must_not_include: "hai"',
    ])
  })
})
