import { resolveArea } from './areaCatalog'
import { formatMinutes } from './format'
import type { AreaCatalog, AssistRow, CallItem } from './types'

const OPEN_STATUSES = new Set<AssistRow['status']>(['pending', 'accepted', 'escalated'])

const toMs = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Number.NaN)

const minutesBetween = (fromIso: string | null | undefined, toMsValue: number): number | null => {
  const fromMs = toMs(fromIso)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMsValue)) return null
  return Math.max(0, Math.round((toMsValue - fromMs) / 60000))
}

const describeIssue = (row: AssistRow): string | null => {
  const parts = [row.issue_type, row.issue_description]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
  const unique = parts.filter((part, index) => parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === index)
  return unique.length ? unique.join(' · ') : null
}

const toCallItem = (row: AssistRow, catalog: AreaCatalog, nowMs: number): CallItem => {
  const area = resolveArea(catalog, row.qr_code_id, row.location_label)
  const isOpen = OPEN_STATUSES.has(row.status)
  return {
    id: row.id,
    status: row.status,
    areaKey: area.key,
    areaName: area.name,
    issue: describeIssue(row),
    reportedAt: row.reported_at,
    acceptedByName: row.accepted_by_name?.trim() || null,
    waitingMinutes: isOpen ? minutesBetween(row.reported_at, nowMs) : null,
    resolvedAt: row.resolved_at ?? null,
    resolvedByName: row.resolved_by_name?.trim() || null,
    resolutionMinutes: row.status === 'resolved' ? minutesBetween(row.reported_at, toMs(row.resolved_at)) : null,
  }
}

/**
 * Call a Cleaner requests for the site: every request still open (longest
 * waiting first, whatever day it came in) and those resolved since the start
 * of today (most recent first). Cancelled requests are neither.
 */
export const buildCalls = (
  rows: AssistRow[],
  catalog: AreaCatalog,
  now: Date,
  dayStart: Date,
): { open: CallItem[]; resolved: CallItem[] } => {
  const nowMs = now.getTime()
  const dayStartMs = dayStart.getTime()
  const unique = Array.from(new Map(rows.map((row) => [row.id, row])).values())

  const open = unique
    .filter((row) => OPEN_STATUSES.has(row.status) && Number.isFinite(toMs(row.reported_at)))
    .sort((a, b) => toMs(a.reported_at) - toMs(b.reported_at))
    .map((row) => toCallItem(row, catalog, nowMs))

  const resolved = unique
    .filter((row) => row.status === 'resolved' && toMs(row.resolved_at) >= dayStartMs)
    .sort((a, b) => toMs(b.resolved_at) - toMs(a.resolved_at))
    .map((row) => toCallItem(row, catalog, nowMs))

  return { open, resolved }
}

/** Mean reported-to-resolved time, in whole minutes, over today's resolved requests. Null when there are none. */
export const averageResponseMinutes = (resolved: CallItem[]): number | null => {
  const durations = resolved
    .map((call) => call.resolutionMinutes)
    .filter((minutes): minutes is number => typeof minutes === 'number')
  if (!durations.length) return null
  return Math.round(durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length)
}

/** "Open · waiting 11 min", or who is on the way once a cleaner has accepted it. */
export const describeOpenCall = (call: CallItem): string => {
  const waiting = `waiting ${formatMinutes(call.waitingMinutes)}`
  return call.status === 'accepted' && call.acceptedByName ? `${call.acceptedByName} on the way · ${waiting}` : `Open · ${waiting}`
}

/** "Resolved in 8 min by Toyeeb"; the parts that are unknown are left out. */
export const describeResolvedCall = (call: CallItem): string => {
  const duration = call.resolutionMinutes === null ? 'Resolved' : `Resolved in ${formatMinutes(call.resolutionMinutes)}`
  return call.resolvedByName ? `${duration} by ${call.resolvedByName}` : duration
}
