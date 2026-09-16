/**
 * Wording for the streak-qualification field.
 *
 * "Streak qualifies at … minutes in a local day" told the user nothing. The
 * label now states the rule outright, and the tip explains the local-day part.
 */

import type { TrackingModel } from '../domain/events/types.ts'

export interface ThresholdCopy {
  /** Whether the field applies to this habit at all. */
  applies: boolean
  label: string
  unit: string
  explanation: string
}

export function thresholdCopy(model: TrackingModel): ThresholdCopy {
  switch (model) {
    case 'duration':
      return {
        applies: true,
        label: 'Minutes needed for a streak day',
        unit: 'minutes',
        explanation:
          'A day joins your streak once you have logged at least this many minutes on it. ' +
          'Several sessions on the same day add up, and days are counted in your own timezone. ' +
          'Set it to 1 to let any amount count.',
      }
    case 'count':
      return {
        applies: true,
        label: 'Sessions needed for a streak day',
        unit: 'sessions',
        explanation:
          'A day joins your streak once you have logged at least this many sessions on it, ' +
          'counted in your own timezone. Set it to 1 to let a single session count.',
      }
    case 'completion':
      return {
        applies: false,
        label: 'Sessions needed for a streak day',
        unit: 'sessions',
        explanation:
          'A completion habit is done or not done, so any session you log makes that day count ' +
          'toward your streak. There is nothing to set.',
      }
    case 'negative-occurrence':
      return {
        applies: false,
        label: 'Streak rule',
        unit: '',
        explanation:
          'Negative habits do not build a streak. The app counts whole days since the last ' +
          'occurrence instead, and any occurrence resets that count to zero.',
      }
  }
}
