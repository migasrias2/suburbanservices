import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/services/supabase', () => ({ supabase: {} }))

const { setClockSwitchesForTests } = await import('@/lib/clock/clockFlags')
const { LegacyScannerRoute } = await import('./LegacyScannerRoute')

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/scanner']}>
      <Routes>
        <Route path="/scanner" element={<LegacyScannerRoute><div>Old scanner</div></LegacyScannerRoute>} />
        <Route path="/clock-in" element={<div>Clock-in page</div>} />
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => cleanup())

describe('/scanner', () => {
  it('goes to the clock-in page on the new clock (its scanner would write clock rows directly)', () => {
    setClockSwitchesForTests({ clockV2: true, scannerV2: true })
    renderAt()
    expect(screen.getByText('Clock-in page')).toBeInTheDocument()
  })

  it('is unchanged with clock_v2 off', () => {
    setClockSwitchesForTests({ clockV2: false, scannerV2: true })
    renderAt()
    expect(screen.getByText('Old scanner')).toBeInTheDocument()
  })
})
