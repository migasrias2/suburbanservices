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

let sitesError: Error | null = null
const loadSitesForUser = vi.fn(async () => {
  if (sitesError) throw sitesError
  return sites
})

vi.mock('@/services/siteDashboardService', () => ({
  loadSitesForUser: (...args: unknown[]) => loadSitesForUser(...(args as [])),
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
  sitesError = null
  loadSiteSnapshot.mockClear()
  loadSitesForUser.mockClear()
})

describe('SiteDashboard when the site lookup fails', () => {
  it('says it could not load the sites, not that none are linked, and recovers on Try again', async () => {
    sitesError = new Error('Could not load your sites. Please try again.')
    renderDashboard('manager')
    expect(await screen.findByText(/We couldn't load your sites/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText(/No site is linked/)).toBeNull()
    expect(loadSiteSnapshot).not.toHaveBeenCalled()

    sitesError = null
    sites = [SEAS]
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(await screen.findByText('Cleans completed')).toBeInTheDocument()
  })
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

  it('opens the timeline newest first', async () => {
    sites = [SEAS]
    renderDashboard('manager')
    expect(await screen.findByRole('button', { name: /Newest first/ })).toBeInTheDocument()
    const times = Array.from(document.querySelectorAll('ol time')).map((node) => node.textContent)
    expect(times[0]).toBe('14:41')
    expect(times[times.length - 1]).toBe('09:40')
  })
})
