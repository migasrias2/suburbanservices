import type { AreaEntry, Clean, Coverage, CoverageItem, CoverageStatus } from './types'

const toMs = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Number.NaN)

const STATUS_ORDER: Record<CoverageStatus, number> = { done: 0, in_progress: 1, not_yet: 2 }

/**
 * Every area at the site as done, in progress or not yet cleaned today.
 *
 * "Done" means at least one clean today; an area being cleaned again right now
 * shows as in progress but still counts towards the done total, because it has
 * been cleaned. Order follows the client's prototype: done (earliest first),
 * then in progress, then the rest alphabetically.
 */
export const buildCoverage = (areas: AreaEntry[], cleans: Clean[], inProgressAreaKeys: Iterable<string>): Coverage => {
  const inProgress = new Set(inProgressAreaKeys)

  const items: CoverageItem[] = areas.map((area) => {
    const areaCleans = cleans.filter((clean) => clean.areaKey === area.key)
    const lastCleanAt = areaCleans.reduce<string | null>(
      (latest, clean) => (latest === null || toMs(clean.at) > toMs(latest) ? clean.at : latest),
      null,
    )
    const status: CoverageStatus = inProgress.has(area.key) ? 'in_progress' : areaCleans.length ? 'done' : 'not_yet'
    return { key: area.key, name: area.name, status, cleanCount: areaCleans.length, lastCleanAt }
  })

  const sorted = [...items].sort((a, b) => {
    if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (a.status === 'done') return toMs(a.lastCleanAt) - toMs(b.lastCleanAt)
    return a.name.localeCompare(b.name)
  })

  return { items: sorted, done: items.filter((item) => item.cleanCount > 0).length, total: items.length }
}
