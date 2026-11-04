import React, { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import type { AppRole } from '@/contexts/AuthContext'
import { formatClock } from '@/lib/siteDashboard/format'
import { pickSelectedSite } from '@/lib/siteDashboard/siteScope'
import type { SiteRef, SiteSnapshot } from '@/lib/siteDashboard/types'
import { loadSiteSnapshot, loadSitesForUser } from '@/services/siteDashboardService'
import { ActivityTimeline } from './ActivityTimeline'
import { CallACleanerCard } from './CallACleanerCard'
import { CoverageCard } from './CoverageCard'
import { OnSiteCard } from './OnSiteCard'
import { EmptyState } from './parts'
import { PhotoEvidence } from './PhotoEvidence'
import { PhotoViewer, type PhotoViewerState } from './PhotoViewer'
import { SiteKpiRow } from './SiteKpiRow'
import { SitePicker } from './SitePicker'

/** The client asked for "about every 30 seconds"; matches the admin live dashboard. */
const SITE_REFRESH_MS = 30_000

const LiveBadge: React.FC<{ updatedAt: string | null; refreshing: boolean }> = ({ updatedAt, refreshing }) => (
  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
    <span className="relative flex h-2 w-2" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
    </span>
    Live · updated {updatedAt ? formatClock(updatedAt) : '—'}
    {refreshing ? <Loader2 className="h-3 w-3 animate-spin" aria-label="Refreshing" /> : null}
  </span>
)

const SiteBody: React.FC<{ snapshot: SiteSnapshot }> = ({ snapshot }) => {
  const [viewer, setViewer] = useState<PhotoViewerState | null>(null)
  const openPhoto = (photos: PhotoViewerState['photos'], index: number, sources: Record<number, string>) =>
    setViewer({ photos, index, sources })

  const dayStart = new Date(snapshot.dayStart)

  // Two layouts from one tree. Below lg the column wrappers are `display:
  // contents`, so every section is a direct flex child placed by `order`:
  // Call a Cleaner, who is on site, timeline, coverage, photos — what a
  // client on a phone needs first. From lg the wrappers become the two
  // columns and DOM order applies.
  return (
    <div className="space-y-6 sm:space-y-8">
      <SiteKpiRow kpis={snapshot.kpis} onSite={snapshot.onSite} />
      <div className="flex flex-col gap-6 sm:gap-8 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="contents lg:block lg:min-w-0 lg:space-y-8">
          <div className="order-3 min-w-0">
            <ActivityTimeline
              items={snapshot.timeline}
              areaOptions={snapshot.areaOptions}
              photos={snapshot.photos}
              onOpenPhoto={openPhoto}
              dayStart={dayStart}
            />
          </div>
          <div className="order-5 min-w-0">
            <PhotoEvidence photos={snapshot.photos} onOpenPhoto={openPhoto} />
          </div>
        </div>
        <div className="contents lg:block lg:min-w-0 lg:space-y-8">
          <div className="order-2 min-w-0">
            <OnSiteCard onSite={snapshot.onSite} />
          </div>
          <div className="order-1 min-w-0">
            <CallACleanerCard calls={snapshot.calls} dayStart={dayStart} />
          </div>
          <div className="order-4 min-w-0">
            <CoverageCard coverage={snapshot.coverage} />
          </div>
        </div>
      </div>
      <PhotoViewer state={viewer} onChange={setViewer} />
    </div>
  )
}

interface SiteDashboardProps {
  role: AppRole
  userId: string
}

/**
 * Live, read-only dashboard for one client site. Clients (manager logins)
 * only ever get the sites linked to their own account; admins and ops
 * managers choose one. Nothing here edits or deletes anything.
 */
export const SiteDashboard: React.FC<SiteDashboardProps> = ({ role, userId }) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const isClient = role === 'manager'

  const sitesQuery = useQuery({
    queryKey: ['site-dashboard-sites', role, userId],
    queryFn: () => loadSitesForUser(role, userId),
    // Only a successful answer is kept for 5 minutes. A failed lookup throws
    // (it is never cached as "no sites") and the page offers Try again.
    staleTime: 5 * 60 * 1000,
    retry: 1,
    retryDelay: 500,
  })
  const sites: SiteRef[] = sitesQuery.data ?? []
  const site = pickSelectedSite(sites, searchParams.get('site'), isClient)

  const snapshotQuery = useQuery({
    queryKey: ['site-dashboard-snapshot', site?.key ?? null],
    queryFn: () => loadSiteSnapshot(site as SiteRef),
    enabled: Boolean(site),
    refetchInterval: SITE_REFRESH_MS,
    placeholderData: (previous) => (previous?.site.key === site?.key ? previous : undefined),
  })

  const chooseSite = (key: string) => setSearchParams({ site: key }, { replace: true })
  const showPicker = sites.length > 1 || (!isClient && sites.length > 0)
  const snapshot = snapshotQuery.data ?? null

  const header = (
    <>
      <PageHeader
        title={site?.name ?? 'Site dashboard'}
        description={site ? ['Site dashboard', site.address].filter(Boolean).join(' · ') : 'Live cleaning activity for one site.'}
        actions={
          <>
            {showPicker ? <SitePicker sites={sites} value={site?.key ?? null} onChange={chooseSite} /> : null}
            {site ? <LiveBadge updatedAt={snapshot?.generatedAt ?? null} refreshing={snapshotQuery.isFetching} /> : null}
          </>
        }
      />
      {/* PageHeader hides the title on phones; the client still needs to see which site this is. */}
      {site ? <h1 className="mb-4 text-title3 font-semibold text-foreground md:hidden">{site.name}</h1> : null}
    </>
  )

  const content = (() => {
    if (sitesQuery.isLoading) return <EmptyState>Loading your sites…</EmptyState>
    if (sitesQuery.isError) {
      return (
        <EmptyState>
          We couldn't load your sites.{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => sitesQuery.refetch()}>
            Try again
          </Button>
        </EmptyState>
      )
    }
    if (!sites.length) {
      return (
        <EmptyState>
          {isClient
            ? 'No site is linked to this login yet. Please contact Suburban Services.'
            : 'No active sites found.'}
        </EmptyState>
      )
    }
    if (!site) return <EmptyState>Choose a site to see its live dashboard.</EmptyState>
    if (snapshotQuery.isError && !snapshot) {
      return (
        <EmptyState>
          {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'Could not load this site.'}{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => snapshotQuery.refetch()}>
            Try again
          </Button>
        </EmptyState>
      )
    }
    if (!snapshot) return <EmptyState>Loading today's activity…</EmptyState>
    return <SiteBody snapshot={snapshot} />
  })()

  return (
    <div className="mx-auto w-full max-w-7xl py-1 sm:py-8">
      {header}
      {snapshotQuery.isError && snapshot ? (
        <p className="mb-4 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning">
          Live updates paused: the last refresh failed. Showing data from {formatClock(snapshot.generatedAt)}.
        </p>
      ) : null}
      {content}
    </div>
  )
}
