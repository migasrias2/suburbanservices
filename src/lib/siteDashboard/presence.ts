import { normalizeCleanerName } from '../identity'
import { resolveArea } from './areaCatalog'
import { displayCleanerName } from './cleans'
import type { AreaCatalog, AreaScanRow, AttendanceRow, Clean, CurrentActivity, OnSiteCleaner } from './types'

/**
 * close_runaway_shifts auto-closes any shift open longer than 12 hours, so an
 * open row older than that is a forgotten clock-out, not a person on site.
 */
export const ON_SITE_MAX_HOURS = 12

/**
 * An area scan with no submit after this long is no longer "being cleaned"
 * right now: the cleaner abandoned it, or the submit never reached us. The
 * longest real area cleans run well under an hour.
 */
export const IN_PROGRESS_MAX_MINUTES = 60

const toMs = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Number.NaN)

const minutesBetween = (fromMs: number, toMsValue: number) => Math.max(0, Math.floor((toMsValue - fromMs) / 60000))

const attendanceKey = (row: AttendanceRow) =>
  row.cleaner_uuid?.trim() || `name:${normalizeCleanerName(row.cleaner_name).toLowerCase()}`

const resolveActivity = (
  cleanerId: string | null,
  clockInMs: number,
  scans: AreaScanRow[],
  cleans: Clean[],
  catalog: AreaCatalog,
  nowMs: number,
): CurrentActivity | null => {
  const ownCleans = cleans
    .filter((clean) => cleanerId && clean.cleanerId === cleanerId && toMs(clean.at) >= clockInMs)
    .sort((a, b) => toMs(b.at) - toMs(a.at))

  // Only scans of this site's own area posters count: a scan elsewhere has no
  // name here, and a QR code is never shown in its place.
  const latestScan = scans
    .filter((scan) => cleanerId && scan.cleaner_id === cleanerId && toMs(scan.timestamp) >= clockInMs)
    .map((scan) => ({ scan, area: resolveArea(catalog, scan.scanned_qr_id) }))
    .filter((entry) => entry.area.key && entry.area.name)
    .sort((a, b) => toMs(b.scan.timestamp) - toMs(a.scan.timestamp))[0]

  if (latestScan) {
    // Any clean submitted after the scan means that scan's work is finished.
    const scanMs = toMs(latestScan.scan.timestamp)
    const submittedSinceScan = ownCleans.some((clean) => toMs(clean.at) >= scanMs)
    const stale = nowMs - scanMs > IN_PROGRESS_MAX_MINUTES * 60000
    if (!submittedSinceScan && !stale) {
      return {
        kind: 'cleaning',
        areaKey: latestScan.area.key as string,
        areaName: latestScan.area.name as string,
        since: latestScan.scan.timestamp as string,
      }
    }
  }

  const lastClean = ownCleans[0]
  return lastClean ? { kind: 'last_cleaned', areaKey: lastClean.areaKey, areaName: lastClean.areaName, at: lastClean.at } : null
}

/**
 * Everyone clocked in at this site right now: an open attendance row from the
 * last ON_SITE_MAX_HOURS. One entry per person, from their latest clock-in.
 * "Currently cleaning" comes from their latest area scan unless a clean was
 * submitted after it.
 */
export const buildOnSite = (
  attendance: AttendanceRow[],
  scans: AreaScanRow[],
  cleans: Clean[],
  catalog: AreaCatalog,
  now: Date,
): OnSiteCleaner[] => {
  const nowMs = now.getTime()
  const oldestOpenMs = nowMs - ON_SITE_MAX_HOURS * 3600 * 1000
  const latestByPerson = new Map<string, AttendanceRow>()

  attendance
    .filter((row) => !row.clock_out)
    .filter((row) => {
      const clockInMs = toMs(row.clock_in)
      return Number.isFinite(clockInMs) && clockInMs >= oldestOpenMs && clockInMs <= nowMs + 5 * 60000
    })
    .forEach((row) => {
      const key = attendanceKey(row)
      const existing = latestByPerson.get(key)
      if (!existing || toMs(row.clock_in) > toMs(existing.clock_in)) latestByPerson.set(key, row)
    })

  return Array.from(latestByPerson.entries())
    .map(([key, row]) => {
      const clockInMs = toMs(row.clock_in)
      const cleanerId = row.cleaner_uuid?.trim() || null
      return {
        key,
        cleanerId,
        name: displayCleanerName(row.cleaner_name),
        clockIn: row.clock_in as string,
        minutesOnSite: minutesBetween(clockInMs, nowMs),
        activity: resolveActivity(cleanerId, clockInMs, scans, cleans, catalog, nowMs),
      }
    })
    .sort((a, b) => toMs(a.clockIn) - toMs(b.clockIn))
}
