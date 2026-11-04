import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildSiteSnapshot } from '@/lib/siteDashboard/snapshot'
import type { SiteRef } from '@/lib/siteDashboard/types'
import {
  CLEANER_ID,
  NOW,
  QR_ECO_MENS,
  QR_PAVILION_LADIES,
  SEAS,
  SEAS_QR_ROWS,
  assistRow,
  at,
  attendanceRow,
  selectionRow,
} from '@/lib/siteDashboard/testFixtures'

let sites: SiteRef[] = []
const snapshot = buildSiteSnapshot(
  SEAS,
  {
    qrRows: SEAS_QR_ROWS,
    areaTaskRows: [],
    attendance: [attendanceRow({})],
    selections: [selectionRow({ id: 1, completed_tasks: null }), selectionRow({ id: 2, timestamp: at(12) })],
    photoRows: [],
    scans: [{ cleaner_id: CLEANER_ID, timestamp: at(14), scanned_qr_id: QR_ECO_MENS }],
    assists: [assistRow({})],
  },
  NOW,
)

const loadSiteSnapshot = vi.fn(async () => snapshot)

vi.mock('@/services/siteDashboardService', () => ({
  loadSitesForUser: vi.fn(async () => sites),
  loadSiteSnapshot: (...args: unknown[]) => loadSiteSnapshot(...(args as [])),
  loadPhotoSources: vi.fn(async () => ({})),
}))

const { SiteDashboard } = await import('./SiteDashboard')

const renderDashboard = (role: 'manager' | 'admin', path = '/site-dashboard') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <SiteDashboard role={role} userId="user-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  sites = []
  loadSiteSnapshot.mockClear()
})

describe('SiteDashboard', () => {
  it('shows a client with no linked site an empty state and loads no site data', async () => {
    renderDashboard('manager')
    expect(await screen.findByText(/No site is linked to this login yet/)).toBeInTheDocument()
    expect(loadSiteSnapshot).not.toHaveBeenCalled()
  })

  it("ignores a ?site= the client is not linked to and shows their own site", async () => {
    sites = [SEAS]
    renderDashboard('manager', '/site-dashboard?site=someone-elses-site')
    expect((await screen.findAllByText('South of England Showground')).length).toBeGreaterThan(0)
    expect(loadSiteSnapshot).toHaveBeenCalledWith(SEAS)
  })

  it('asks an admin to choose a site before loading anything', async () => {
    sites = [SEAS]
    renderDashboard('admin')
    expect(await screen.findByText(/Choose a site to see its live dashboard/)).toBeInTheDocument()
    expect(loadSiteSnapshot).not.toHaveBeenCalled()
  })

  it('renders the KPIs, area names and live work, with no delete control anywhere', async () => {
    sites = [SEAS]
    renderDashboard('manager')
    expect(await screen.findByText('Cleans completed')).toBeInTheDocument()
    expect(screen.getByText('1 open')).toBeInTheDocument()
    expect(screen.getAllByText("Pavilion Ladies'").length).toBeGreaterThan(0)
    expect(screen.getByText('Currently cleaning')).toBeInTheDocument()
    expect(screen.queryByText(QR_PAVILION_LADIES)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete|remove|clear/i })).toBeNull()
  })
})
