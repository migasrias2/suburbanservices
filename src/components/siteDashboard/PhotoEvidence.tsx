import React, { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FilterStrip } from '@/components/layout/PageHeader'
import type { SitePhoto } from '@/lib/siteDashboard/types'
import { LazyPhotoGroup, type OpenPhotoHandler } from './LazyPhotoGroup'
import { EmptyState, FilterChip, SectionHeading } from './parts'

/** Photos are fetched one page-chunk at a time as each chunk scrolls into view. */
const CHUNK_SIZE = 8
const INITIAL_CHUNKS = 2

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

export const PhotoEvidence: React.FC<{ photos: SitePhoto[]; onOpenPhoto: OpenPhotoHandler }> = ({ photos, onOpenPhoto }) => {
  const [areaKey, setAreaKey] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(INITIAL_CHUNKS)

  const areas = useMemo(() => {
    const byKey = new Map<string, string>()
    photos.forEach((photo) => photo.areaKey && photo.areaName && byKey.set(photo.areaKey, photo.areaName))
    return Array.from(byKey.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [photos])

  const activeAreaKey = areaKey && areas.some((area) => area.key === areaKey) ? areaKey : null
  // Newest first: the gallery is "what does it look like now".
  const filtered = useMemo(
    () => photos.filter((photo) => !activeAreaKey || photo.areaKey === activeAreaKey).slice().reverse(),
    [photos, activeAreaKey],
  )
  const chunks = chunk(filtered, CHUNK_SIZE)
  const shownChunks = chunks.slice(0, chunkCount)

  // The viewer steps through the whole filtered gallery, not just one chunk.
  const openInGallery: OpenPhotoHandler = (group, index, sources) => {
    const position = filtered.findIndex((photo) => photo.id === group[index]?.id)
    onOpenPhoto(filtered, position < 0 ? 0 : position, sources)
  }

  return (
    <section>
      <SectionHeading title="Photo evidence" aside={`${filtered.length} today · tap to enlarge`} />
      {!photos.length ? (
        <EmptyState>No photos taken at this site yet today.</EmptyState>
      ) : (
        <>
          {areas.length > 1 ? (
            <FilterStrip className="mb-3">
              <FilterChip active={!activeAreaKey} onClick={() => setAreaKey(null)}>
                All areas
              </FilterChip>
              {areas.map((area) => (
                <FilterChip key={area.key} active={activeAreaKey === area.key} onClick={() => setAreaKey(area.key)}>
                  {area.name}
                </FilterChip>
              ))}
            </FilterStrip>
          ) : null}
          <div className="space-y-2 rounded-3xl border border-border bg-card p-3 sm:p-4">
            {shownChunks.map((group) => (
              <LazyPhotoGroup key={group[0].id} photos={group} onOpen={openInGallery} layout="grid" captioned />
            ))}
            {chunks.length > shownChunks.length ? (
              <div className="flex justify-center pt-2">
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setChunkCount((n) => n + INITIAL_CHUNKS)}>
                  Show more photos
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
