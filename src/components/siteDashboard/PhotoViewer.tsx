import React, { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/siteDashboard/format'
import type { SitePhoto } from '@/lib/siteDashboard/types'
import { usePhotoSources } from './usePhotoSources'

export type PhotoViewerState = {
  photos: SitePhoto[]
  index: number
  sources: Record<number, string>
}

interface PhotoViewerProps {
  state: PhotoViewerState | null
  onChange: (state: PhotoViewerState | null) => void
}

/** Full-size photo with previous / next (buttons, arrow keys) across the group it was opened from. */
export const PhotoViewer: React.FC<PhotoViewerProps> = ({ state, onChange }) => {
  const photo = state ? state.photos[state.index] : null
  const knownSrc = photo && state ? state.sources[photo.id] : undefined
  const fetched = usePhotoSources(photo && !knownSrc ? [photo.id] : [], Boolean(photo && !knownSrc))
  const src = knownSrc ?? (photo ? fetched.data?.[photo.id] : undefined)
  const count = state?.photos.length ?? 0

  const go = (step: number) => {
    if (!state || count < 2) return
    const index = (state.index + step + count) % count
    onChange({ ...state, index, sources: { ...state.sources, ...(fetched.data ?? {}) } })
  }

  useEffect(() => {
    if (!state) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') go(1)
      if (event.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const caption = photo
    ? [photo.areaName ?? 'Area not recorded', photo.taskName, photo.cleanerName, formatClock(photo.at)]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => (open ? undefined : onChange(null))}>
      <DialogContent className="max-w-3xl gap-3 p-3 sm:p-4">
        <DialogTitle className="sr-only">Cleaning photo</DialogTitle>
        <DialogDescription className="sr-only">{caption}</DialogDescription>
        <div className="relative flex min-h-[40dvh] items-center justify-center overflow-hidden rounded-2xl bg-muted">
          {src ? (
            <img src={src} alt={caption} className="max-h-[70dvh] w-full object-contain" />
          ) : fetched.isError ? (
            <p className="p-6 text-sm text-muted-foreground">This photo could not be loaded.</p>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading photo" />
          )}
          {count > 1 ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => go(-1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full shadow-md"
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => go(1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full shadow-md"
                aria-label="Next photo"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 text-sm">
          <span className="text-foreground">{caption}</span>
          {count > 1 && state ? (
            <span className="text-xs text-muted-foreground" data-numeric>
              {state.index + 1} / {count}
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
