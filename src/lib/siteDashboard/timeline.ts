import { displayCleanerName } from './cleans'
import type { AttendanceRow, CallItem, Clean, OnSiteCleaner, TimelineItem } from './types'

export type TimelineFilter = 'all' | 'cleans' | 'calls' | 'photos'
export type TimelineOrder = 'oldest' | 'newest'

const toMs = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Number.NaN)

type TimelineInput = {
  attendance: AttendanceRow[]
  cleans: Clean[]
  onSite: OnSiteCleaner[]
  calls: { open: CallItem[]; resolved: CallItem[] }
  dayStart: Date
}

/**
 * One chronological list of today's activity at the site: arrivals and
 * departures, each clean, each area being cleaned right now, and each Call a
 * Cleaner request (at the time it was reported, carrying its outcome).
 * Open requests from before today stay on it until they are dealt with.
 */
export const buildTimeline = ({ attendance, cleans, onSite, calls, dayStart }: TimelineInput): TimelineItem[] => {
  const dayStartMs = dayStart.getTime()
  const items: TimelineItem[] = []

  attendance.forEach((row) => {
    const cleanerName = displayCleanerName(row.cleaner_name)
    if (row.clock_in && toMs(row.clock_in) >= dayStartMs) {
      items.push({ kind: 'clock_in', id: `in-${row.id}`, at: row.clock_in, cleanerName, areaKey: null })
    }
    if (row.clock_out && toMs(row.clock_out) >= dayStartMs) {
      items.push({ kind: 'clock_out', id: `out-${row.id}`, at: row.clock_out, cleanerName, areaKey: null })
    }
  })

  cleans.forEach((clean) => items.push({ kind: 'clean', id: clean.id, at: clean.at, clean, areaKey: clean.areaKey }))

  onSite.forEach((person) => {
    if (person.activity?.kind !== 'cleaning') return
    items.push({
      kind: 'in_progress',
      id: `live-${person.key}`,
      at: person.activity.since,
      cleanerName: person.name,
      areaName: person.activity.areaName,
      areaKey: person.activity.areaKey,
    })
  })

  ;[...calls.open, ...calls.resolved].forEach((call) =>
    items.push({ kind: 'call', id: `call-${call.id}`, at: call.reportedAt, call, areaKey: call.areaKey }),
  )

  return items
    .filter((item) => Number.isFinite(toMs(item.at)))
    .sort((a, b) => toMs(a.at) - toMs(b.at) || a.id.localeCompare(b.id))
}

const matchesFilter = (item: TimelineItem, filter: TimelineFilter): boolean => {
  switch (filter) {
    case 'cleans':
      return item.kind === 'clean' || item.kind === 'in_progress'
    case 'calls':
      return item.kind === 'call'
    case 'photos':
      return item.kind === 'clean' && item.clean.photoIds.length > 0
    case 'all':
    default:
      return true
  }
}

/** Type filter, then area filter (which drops clock events: they have no area), then order. */
export const filterTimeline = (
  items: TimelineItem[],
  options: { filter: TimelineFilter; areaKey: string | null; order: TimelineOrder },
): TimelineItem[] => {
  const filtered = items
    .filter((item) => matchesFilter(item, options.filter))
    .filter((item) => !options.areaKey || item.areaKey === options.areaKey)
  return options.order === 'newest' ? [...filtered].reverse() : filtered
}

/** Areas that appear on today's timeline, for the area filter. */
export const timelineAreaOptions = (items: TimelineItem[]): Array<{ key: string; name: string }> => {
  const options = new Map<string, string>()
  items.forEach((item) => {
    if (item.kind === 'clean' && item.clean.areaKey && item.clean.areaName) {
      options.set(item.clean.areaKey, item.clean.areaName)
    } else if (item.kind === 'in_progress') {
      options.set(item.areaKey, item.areaName)
    } else if (item.kind === 'call' && item.call.areaKey && item.call.areaName) {
      options.set(item.call.areaKey, item.call.areaName)
    }
  })
  return Array.from(options.entries())
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
