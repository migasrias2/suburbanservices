import React from 'react'
import { Camera } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useInView } from '@/hooks/useInView'
import { clsx } from 'clsx'
import { cn } from '@/lib/utils'
import { formatClock } from '@/lib/siteDashboard/format'
import type { SitePhoto } from '@/lib/siteDashboard/types'
import { usePhotoSources } from './usePhotoSources'

export type OpenPhotoHandler = (photos: SitePhoto[], index: number, sources: Record<number, string>) => void

interface LazyPhotoGroupProps {
  photos: SitePhoto[]
  onOpen: OpenPhotoHandler
  layout: 'strip' | 'grid'
  /** Show area and time over each thumbnail (gallery); the timeline already says both. */
  captioned?: boolean
}

/**
 * Thumbnails for one group of photos. Nothing is downloaded until the group
 * scrolls near the viewport, and then only this group's photos, so a long day
 * never turns into one huge request of base64 blobs.
 */
export const LazyPhotoGroup: React.FC<LazyPhotoGroupProps> = ({ photos, onOpen, layout, captioned = false }) => {
  const { ref, inView } = useInView<HTMLDivElement>()
  const sourcesQuery = usePhotoSources(
    photos.map((photo) => photo.id),
    inView,
  )
  const sources = sourcesQuery.data ?? {}
  const isLoading = !inView || sourcesQuery.isLoading

  return (
    <div
      ref={ref}
      className={cn(
        layout === 'strip'
          ? 'flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]'
          : 'grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4',
      )}
    >
      {photos.map((photo, index) => {
        const src = sources[photo.id]
        const sizeClass = layout === 'strip' ? 'h-20 w-24 shrink-0 sm:h-[4.5rem] sm:w-24' : 'aspect-[4/3] w-full'
        if (isLoading) {
          return <Skeleton key={photo.id} className={cn('rounded-xl', sizeClass)} />
        }
        if (!src) {
          return (
            <div
              key={photo.id}
              className={clsx(
                'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted text-caption2 text-muted-foreground',
                sizeClass,
              )}
            >
              <Camera className="mb-1 h-4 w-4" aria-hidden />
              {sourcesQuery.isError ? 'Not loaded' : 'Unavailable'}
            </div>
          )
        }
        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => onOpen(photos, index, sources)}
            className={cn(
              'group relative overflow-hidden rounded-xl border border-border bg-muted transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sizeClass,
            )}
            aria-label={`Open photo${photo.areaName ? ` of ${photo.areaName}` : ''} taken at ${formatClock(photo.at)}`}
          >
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
            {captioned ? (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left">
                <span className="block truncate text-caption2 font-medium text-white">
                  {photo.areaName ?? 'Area not recorded'}
                </span>
                <span className="block text-caption2 text-white/80">{formatClock(photo.at)}</span>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
