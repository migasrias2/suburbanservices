import { describe, expect, it } from 'vitest'
import { groupPhotosNewestFirst, photoGroupKey } from './photoGroups'

const photos = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1 }))
const ids = (groups: Array<Array<{ id: number }>>) => groups.map((group) => group.map((photo) => photo.id))

describe('groupPhotosNewestFirst', () => {
  it('shows the newest group first and the newest photo first within it', () => {
    expect(ids(groupPhotosNewestFirst(photos(5), 2))).toEqual([[5], [4, 3], [2, 1]])
  })

  it('leaves every older group untouched when a new photo arrives', () => {
    const before = groupPhotosNewestFirst(photos(17), 8)
    const after = groupPhotosNewestFirst(photos(18), 8)
    expect(ids(after).slice(1)).toEqual(ids(before).slice(1))
    expect(after.slice(1).map(photoGroupKey)).toEqual(before.slice(1).map(photoGroupKey))
  })

  it('keeps the newest group key while it fills up', () => {
    const before = groupPhotosNewestFirst(photos(17), 8)
    const after = groupPhotosNewestFirst(photos(18), 8)
    expect(photoGroupKey(after[0])).toBe(photoGroupKey(before[0]))
  })

  it('handles nothing and nonsense sizes', () => {
    expect(groupPhotosNewestFirst([], 8)).toEqual([])
    expect(groupPhotosNewestFirst(photos(3), 0)).toEqual([])
  })
})
