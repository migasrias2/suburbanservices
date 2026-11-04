import { isClockAreaName } from '../siteLabel'
import { normalizeName } from './siteScope'
import type { AreaCatalog, AreaEntry, AreaTaskRow, QrCodeRow } from './types'

type QrKind = 'AREA' | 'TASK' | 'CLOCK_IN' | 'CLOCK_OUT' | 'FEEDBACK'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Labels that name a kind of place or a QR poster, never an actual place. */
const RESERVED_LABELS = new Set([
  'area',
  'site',
  'unknown area',
  'unknown site',
  'unassigned area',
  'unassigned customer',
  'area qr code',
  'task qr code',
  'feedback qr code',
  'clock in qr code',
  'clock out qr code',
  'bathrooms ablutions',
  'admin office',
  'general areas',
  'warehouse industrial',
  'kitchen canteen',
  'reception common',
  'ops site inspection',
])

/** Default area_description written by qrService.defaultAreaDescription, keyed to the QR kind it implies. */
const DEFAULT_DESCRIPTION_KIND: Record<string, QrKind> = {
  'clock in qr code': 'CLOCK_IN',
  'clock out qr code': 'CLOCK_OUT',
  'task qr code': 'TASK',
  'feedback qr code': 'FEEDBACK',
  'area qr code': 'AREA',
}

const NON_AREA_TASK_TYPES = new Set(['CLOCK_IN', 'CLOCK_OUT', 'FEEDBACK'])

/** area_tasks rows of this type are the area placeholder itself, not a checklist item. */
const PLACEHOLDER_TASK_TYPES = new Set(['AREA', 'TASK', ...NON_AREA_TASK_TYPES])

/**
 * Is this something a client would recognise as a place?
 *
 * Rejects anything that looks like a code: UUIDs, QR ids, snake_case or
 * SHOUTY-KEBAB identifiers, "QR" labels, area-type names, clock posters and
 * the site's own name. A label that fails here is never shown — the dashboard
 * says "Area not recorded" instead of leaking a code name.
 */
export const isHumanAreaLabel = (
  value: string | null | undefined,
  context: { qrCodeIds?: Iterable<string>; siteNames?: Iterable<string> } = {},
): boolean => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return false
  if (UUID_PATTERN.test(trimmed)) return false
  if (/\bqr\b/i.test(trimmed) || /^ops[_-]?inspection/i.test(trimmed)) return false
  if (!/[a-z]/i.test(trimmed)) return false

  const hasWhitespace = /\s/.test(trimmed)
  if (!hasWhitespace && trimmed.includes('_')) return false
  if (!hasWhitespace && trimmed.includes('-') && trimmed === trimmed.toUpperCase()) return false

  const normalized = normalizeName(trimmed)
  if (RESERVED_LABELS.has(normalized)) return false
  if (isClockAreaName(trimmed)) return false

  for (const qrId of context.qrCodeIds ?? []) {
    if (normalizeName(qrId) === normalized) return false
  }
  for (const siteName of context.siteNames ?? []) {
    if (normalizeName(siteName) === normalized) return false
  }
  return true
}

type ParsedQrPayload = { type: string | null; areaName: string | null }

const parseQrPayload = (raw: string | null): ParsedQrPayload => {
  if (!raw) return { type: null, areaName: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { type: null, areaName: null }
    const record = parsed as { type?: unknown; metadata?: { areaName?: unknown } }
    return {
      type: typeof record.type === 'string' ? record.type : null,
      areaName: typeof record.metadata?.areaName === 'string' ? record.metadata.areaName : null,
    }
  } catch {
    return { type: null, areaName: null }
  }
}

const toQrKind = (value: string | null | undefined): QrKind | null => {
  const canonical = (value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (canonical === 'CLOCK_IN' || canonical === 'CLOCKIN') return 'CLOCK_IN'
  if (canonical === 'CLOCK_OUT' || canonical === 'CLOCKOUT') return 'CLOCK_OUT'
  if (canonical === 'FEEDBACK') return 'FEEDBACK'
  if (canonical === 'TASK') return 'TASK'
  if (canonical === 'AREA') return 'AREA'
  return null
}

const qrKindOf = (row: QrCodeRow, payload: ParsedQrPayload): QrKind => {
  const fromPayload = toQrKind(payload.type)
  if (fromPayload) return fromPayload
  const fromDescription = DEFAULT_DESCRIPTION_KIND[normalizeName(row.area_description)]
  if (fromDescription) return fromDescription
  if (isClockAreaName(row.building_area)) return 'CLOCK_IN'
  return 'AREA'
}

type CatalogInput = {
  qrRows: QrCodeRow[]
  areaTaskRows: AreaTaskRow[]
  siteNames: string[]
  /** Built-in task ids (qrService AREA_TASKS) -> names, used when a site has no custom tasks. */
  defaultTaskNames?: Record<string, string>
}

/**
 * Every area at a site, and how to name the area behind any QR code.
 *
 * Sources, in order of authority: building_qr_codes.building_area (what the
 * admin typed when the poster was made), the areaName inside the QR payload,
 * a non-default area_description, then area_tasks.area. Clock-in, clock-out
 * and feedback posters are not areas and are left out entirely.
 */
export const buildAreaCatalog = ({ qrRows, areaTaskRows, siteNames, defaultTaskNames = {} }: CatalogInput): AreaCatalog => {
  const allQrIds = new Set<string>()
  qrRows.forEach((row) => row.qr_code_id && allQrIds.add(row.qr_code_id.trim()))
  areaTaskRows.forEach((row) => row.qr_code && allQrIds.add(row.qr_code.trim()))

  const context = { qrCodeIds: allQrIds, siteNames }
  const entries = new Map<string, AreaEntry>()
  const byQrId = new Map<string, AreaEntry>()

  const upsertEntry = (name: string, qrCodeId: string | null, active: boolean) => {
    const key = normalizeName(name)
    const existing = entries.get(key)
    const entry: AreaEntry = existing
      ? { ...existing, inCoverage: existing.inCoverage || active }
      : { key, name: name.trim().replace(/\s+/g, ' '), qrCodeIds: [], inCoverage: active }
    const withQr =
      qrCodeId && !entry.qrCodeIds.includes(qrCodeId) ? { ...entry, qrCodeIds: [...entry.qrCodeIds, qrCodeId] } : entry
    entries.set(key, withQr)
    withQr.qrCodeIds.forEach((id) => byQrId.set(id, withQr))
  }

  qrRows.forEach((row) => {
    const qrId = row.qr_code_id?.trim() || null
    const payload = parseQrPayload(row.qr_code_url)
    const kind = qrKindOf(row, payload)
    if (kind !== 'AREA' && kind !== 'TASK') return
    const description = DEFAULT_DESCRIPTION_KIND[normalizeName(row.area_description)] ? null : row.area_description
    const name = [row.building_area, payload.areaName, description].find((candidate) =>
      isHumanAreaLabel(candidate, context),
    )
    if (name) upsertEntry(name, qrId, row.is_active !== false)
  })

  const taskNames = new Map<string, string>(Object.entries(defaultTaskNames))

  areaTaskRows.forEach((row) => {
    const taskType = (row.task_type ?? '').trim().toUpperCase()
    if (NON_AREA_TASK_TYPES.has(taskType)) return
    const qrId = row.qr_code?.trim() || null
    const areaName = isHumanAreaLabel(row.area, context) ? (row.area as string) : null
    if (areaName && !(qrId && byQrId.has(qrId))) {
      upsertEntry(areaName, qrId, row.active !== false)
    }
    const description = row.task_description?.trim()
    const isPlaceholder =
      PLACEHOLDER_TASK_TYPES.has(taskType) || normalizeName(description) === normalizeName(row.area)
    if (row.id !== null && row.id !== undefined && description && !isPlaceholder) {
      taskNames.set(String(row.id), description)
    }
  })

  const areas = Array.from(entries.values())
    .filter((entry) => entry.inCoverage)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { areas, byQrId, taskNames, qrCodeIds: Array.from(allQrIds), siteNames }
}

/**
 * The human name for the area behind a QR code. Falls back to free-text labels
 * (a photo's area_name, an assist request's location_label) only when they
 * pass isHumanAreaLabel. Returns null rather than ever returning a code.
 */
export const resolveArea = (
  catalog: AreaCatalog,
  qrCodeId: string | null | undefined,
  ...fallbacks: Array<string | null | undefined>
): { key: string | null; name: string | null } => {
  const entry = qrCodeId ? catalog.byQrId.get(qrCodeId.trim()) : undefined
  if (entry) return { key: entry.key, name: entry.name }
  const context = { qrCodeIds: catalog.qrCodeIds, siteNames: catalog.siteNames }
  const label = fallbacks.find((candidate) => isHumanAreaLabel(candidate, context))
  if (!label) return { key: null, name: null }
  const key = normalizeName(label)
  const known = catalog.areas.find((area) => area.key === key)
  return { key, name: known?.name ?? label.trim().replace(/\s+/g, ' ') }
}
