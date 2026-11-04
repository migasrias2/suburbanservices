import { buildAreaCatalog } from './areaCatalog'
import { averageResponseMinutes, buildCalls } from './callACleaner'
import { buildCleans } from './cleans'
import { buildCoverage } from './coverage'
import { buildOnSite } from './presence'
import { buildSiteMatcher } from './siteScope'
import { buildTimeline, timelineAreaOptions } from './timeline'
import type {
  AreaScanRow,
  AreaTaskRow,
  AssistRow,
  AttendanceRow,
  Clean,
  OnSiteCleaner,
  PhotoMetaRow,
  QrCodeRow,
  SelectionRow,
  SiteKpis,
  SiteRef,
  SiteSnapshot,
} from './types'

export type SiteRawData = {
  qrRows: QrCodeRow[]
  areaTaskRows: AreaTaskRow[]
  attendance: AttendanceRow[]
  selections: SelectionRow[]
  photoRows: PhotoMetaRow[]
  scans: AreaScanRow[]
  assists: AssistRow[]
}

export const startOfLocalDay = (now: Date): Date => {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start
}

export const buildKpis = (input: {
  onSite: OnSiteCleaner[]
  cleans: Clean[]
  photoCount: number
  calls: SiteSnapshot['calls']
}): SiteKpis => ({
  onSiteCount: input.onSite.length,
  cleansCompleted: input.cleans.length,
  inProgress: input.onSite.filter((person) => person.activity?.kind === 'cleaning').length,
  photos: input.photoCount,
  openCalls: input.calls.open.length,
  resolvedToday: input.calls.resolved.length,
  avgResponseMinutes: averageResponseMinutes(input.calls.resolved),
})

/**
 * Re-applies the site scope to every row that carries a customer name. The
 * queries already filter server-side; this is the second lock, so a loose
 * server filter (or a future edit to one) cannot put another client's row on
 * the screen. Selections, photos and scans carry no customer name: they are
 * fetched by this site's QR ids only, and anything whose QR is not the site's
 * is dropped here.
 */
export const scopeRawData = (site: SiteRef, raw: SiteRawData): SiteRawData => {
  const matchesSite = buildSiteMatcher(site.matchNames)
  const qrRows = raw.qrRows.filter((row) => matchesSite(row.customer_name))
  const areaTaskRows = raw.areaTaskRows.filter((row) => matchesSite(row.customer_name))
  const siteQrIds = new Set<string>([
    ...qrRows.flatMap((row) => (row.qr_code_id ? [row.qr_code_id.trim()] : [])),
    ...areaTaskRows.flatMap((row) => (row.qr_code ? [row.qr_code.trim()] : [])),
  ])
  const isSiteQr = (qrId: string | null) => Boolean(qrId && siteQrIds.has(qrId.trim()))

  return {
    qrRows,
    areaTaskRows,
    attendance: raw.attendance.filter((row) => matchesSite(row.customer_name, row.site_name)),
    selections: raw.selections.filter((row) => isSiteQr(row.qr_code_id)),
    photoRows: raw.photoRows.filter((row) => isSiteQr(row.qr_code_id)),
    scans: raw.scans,
    assists: raw.assists.filter((row) => matchesSite(row.customer_name)),
  }
}

/** Every number and list on the dashboard, from raw rows. Pure: same rows and clock, same screen. */
export const buildSiteSnapshot = (
  site: SiteRef,
  raw: SiteRawData,
  now: Date,
  defaultTaskNames: Record<string, string> = {},
): SiteSnapshot => {
  const scoped = scopeRawData(site, raw)
  const dayStart = startOfLocalDay(now)
  const catalog = buildAreaCatalog({
    qrRows: scoped.qrRows,
    areaTaskRows: scoped.areaTaskRows,
    siteNames: site.matchNames,
    defaultTaskNames,
  })
  const { cleans, photos } = buildCleans(scoped.selections, scoped.photoRows, catalog)
  const onSite = buildOnSite(scoped.attendance, scoped.scans, cleans, catalog, now)
  const calls = buildCalls(scoped.assists, catalog, now, dayStart)
  const inProgressKeys = onSite.flatMap((person) =>
    person.activity?.kind === 'cleaning' ? [person.activity.areaKey] : [],
  )
  const coverage = buildCoverage(catalog.areas, cleans, inProgressKeys)
  const timeline = buildTimeline({ attendance: scoped.attendance, cleans, onSite, calls, dayStart })

  return {
    site,
    generatedAt: now.toISOString(),
    kpis: buildKpis({ onSite, cleans, photoCount: photos.length, calls }),
    onSite,
    timeline,
    calls,
    coverage,
    photos,
    areaOptions: timelineAreaOptions(timeline),
  }
}
