import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpTip } from './HelpTip.tsx'

function Field(): React.JSX.Element {
  return (
    <div>
      <label className="fieldLabel" htmlFor="threshold">
        Minutes needed for a streak day
      </label>
      <HelpTip id="threshold-help" label="Minutes needed for a streak day">
        A day joins your streak once you have logged at least this many minutes on it.
      </HelpTip>
      <input id="threshold" aria-describedby="threshold-help" />
    </div>
  )
}

describe('HelpTip', () => {
  it('describes the field even while collapsed, so it reaches a screen reader', () => {
    render(<Field />)
    // The accessible description resolves whether or not the tip is open.
    expect(screen.getByLabelText('Minutes needed for a streak day')).toHaveAccessibleDescription(
      /A day joins your streak/,
    )
    expect(screen.getByRole('button', { name: /What .* means/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('reveals the explanation on click, which is the only thing touch can do', async () => {
    render(<Field />)
    const trigger = screen.getByRole('button', { name: /What .* means/ })

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('note')).toBeVisible()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape', async () => {
    render(<Field />)
    const trigger = screen.getByRole('button', { name: /What .* means/ })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
