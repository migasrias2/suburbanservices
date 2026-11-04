import { normalizeCleanerName } from '../identity'
import { resolveArea } from './areaCatalog'
import type { AreaCatalog, Clean, PhotoMetaRow, SelectionRow, SitePhoto } from './types'

/** Ops site inspections share the selections table but are not cleans. */
const NON_CLEAN_AREA_TYPES = new Set(['OPS_SITE_INSPECTION'])

/**
 * Photo capture times run slightly behind the submit button, and device clocks
 * drift, so a photo stamped a moment after its clean is still that clean's.
 */
const PHOTO_MATCH_TOLERANCE_MS = 2 * 60 * 1000

/** selected_tasks / completed_tasks arrive as a JSON string in some rows and a real array in others. */
export const parseTaskIds = (value: unknown): string[] => {
  const fromArray = (items: unknown[]) =>
    items.map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '')).filter(Boolean)
  if (Array.isArray(value)) return fromArray(value)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? fromArray(parsed) : []
  } catch {
    return []
  }
}

const toMs = (iso: string | null | undefined): number => {
  if (!iso) return Number.NaN
  return new Date(iso).getTime()
}

export const displayCleanerName = (value: string | null | undefined): string => {
  const normalized = normalizeCleanerName(value)
  return normalized === 'Unknown Cleaner' ? 'Cleaner' : normalized
}

const cleanerKey = (cleanerId: string | null, cleanerName: string | null): string =>
  cleanerId?.trim() || normalizeCleanerName(cleanerName).toLowerCase()

/**
 * One clean per task-selection row. A selection row is written when the
 * cleaner submits an area, so it is the clean — whether or not any photo made
 * it to the server. Photos are attached afterwards, never required.
 */
export const buildCleans = (
  selections: SelectionRow[],
  photoRows: PhotoMetaRow[],
  catalog: AreaCatalog,
): { cleans: Clean[]; photos: SitePhoto[] } => {
  const baseCleans: Clean[] = selections
    .filter((row) => !NON_CLEAN_AREA_TYPES.has((row.area_type ?? '').trim().toUpperCase()))
    .filter((row) => Number.isFinite(toMs(row.timestamp)))
    .map((row) => {
      const area = resolveArea(catalog, row.qr_code_id)
      const completed = parseTaskIds(row.completed_tasks)
      const taskIds = completed.length ? completed : parseTaskIds(row.selected_tasks)
      const tasks = taskIds
        .map((id) => catalog.taskNames.get(id))
        .filter((name): name is string => Boolean(name))
      return {
        id: `clean-${row.id}`,
        at: row.timestamp as string,
        cleanerId: row.cleaner_id?.trim() || null,
        cleanerName: displayCleanerName(row.cleaner_name),
        qrCodeId: row.qr_code_id?.trim() || null,
        areaKey: area.key,
        areaName: area.name,
        tasks: Array.from(new Set(tasks)),
        taskCount: taskIds.length,
        photoIds: [],
      }
    })
    .sort((a, b) => toMs(a.at) - toMs(b.at))

  const photoIdsByClean = new Map<string, number[]>()
  const photos: SitePhoto[] = photoRows
    .filter((row) => Number.isFinite(toMs(row.photo_timestamp)))
    .sort((a, b) => toMs(a.photo_timestamp) - toMs(b.photo_timestamp))
    .map((row) => {
      const photoMs = toMs(row.photo_timestamp)
      const key = cleanerKey(row.cleaner_id, row.cleaner_name)
      const qrId = row.qr_code_id?.trim() || null
      const owner = baseCleans.find(
        (clean) =>
          clean.qrCodeId === qrId &&
          cleanerKey(clean.cleanerId, clean.cleanerName) === key &&
          toMs(clean.at) + PHOTO_MATCH_TOLERANCE_MS >= photoMs,
      )
      if (owner) photoIdsByClean.set(owner.id, [...(photoIdsByClean.get(owner.id) ?? []), row.id])
      const area = owner ? { key: owner.areaKey, name: owner.areaName } : resolveArea(catalog, qrId)
      return {
        id: row.id,
        at: row.photo_timestamp as string,
        cleanerName: displayCleanerName(row.cleaner_name),
        areaKey: area.key,
        areaName: area.name,
        taskName: row.task_id ? catalog.taskNames.get(row.task_id.trim()) ?? null : null,
        cleanId: owner?.id ?? null,
      }
    })

  const cleans = baseCleans.map((clean) => ({ ...clean, photoIds: photoIdsByClean.get(clean.id) ?? [] }))
  return { cleans, photos }
}
