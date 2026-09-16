import { describe, expect, it } from 'vitest'
import { thresholdCopy } from './streak-threshold.ts'

describe('streak threshold wording', () => {
  it('states the rule in the label rather than leaving it to a unit hint', () => {
    expect(thresholdCopy('duration').label).toBe('Minutes needed for a streak day')
    expect(thresholdCopy('count').label).toBe('Sessions needed for a streak day')
  })

  it('explains the local-day rule in plain words', () => {
    const duration = thresholdCopy('duration')
    expect(duration.explanation).toMatch(/at least this many minutes/)
    expect(duration.explanation).toMatch(/own timezone/)
    expect(duration.explanation).not.toMatch(/local day/)
  })

  it('hides the field where it means nothing', () => {
    expect(thresholdCopy('completion').applies).toBe(false)
    expect(thresholdCopy('negative-occurrence').applies).toBe(false)
    expect(thresholdCopy('negative-occurrence').explanation).toMatch(/do not build a streak/)
  })
})
