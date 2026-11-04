/**
 * Splits photos (oldest first) into gallery groups shown newest first.
 *
 * Groups are cut from the OLDEST end, so a new photo only ever changes the
 * newest group. Every other group keeps the same ids, and so the same React
 * key and the same cached signed URLs, across the 30-second refresh.
 */
export const groupPhotosNewestFirst = <T extends { id: number }>(oldestFirst: T[], size: number): T[][] => {
  if (size < 1) return []
  return Array.from({ length: Math.ceil(oldestFirst.length / size) }, (_, index) =>
    oldestFirst.slice(index * size, (index + 1) * size).reverse(),
  ).reverse()
}

/** A key that stays put while a group fills up: its oldest photo's id. */
export const photoGroupKey = <T extends { id: number }>(group: T[]): string =>
  group.length ? String(group[group.length - 1].id) : 'empty'
