import React from 'react'
import { toAssistPhotoUrls } from '@/lib/assistPhotos'

type AssistPhotoStripProps = {
  beforeMedia: unknown
  afterMedia: unknown
}

const PhotoRow: React.FC<{ label: string; urls: string[] }> = ({ label, urls }) => (
  <div>
    <p className="text-caption2 font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {urls.map((url, index) => (
        <img
          key={url}
          src={url}
          alt={`${label} photo ${index + 1}`}
          loading="lazy"
          title="Open full size"
          // Cards can themselves be buttons, so open the photo without toggling the card.
          onClick={(event) => {
            event.stopPropagation()
            window.open(url, '_blank', 'noopener,noreferrer')
          }}
          className="h-16 w-16 cursor-zoom-in rounded-xl border border-border object-cover"
        />
      ))}
    </div>
  </div>
)

// Before photos come from whoever reported the request; after photos from the
// cleaner who resolved it.
export const AssistPhotoStrip: React.FC<AssistPhotoStripProps> = ({ beforeMedia, afterMedia }) => {
  const before = toAssistPhotoUrls(beforeMedia)
  const after = toAssistPhotoUrls(afterMedia)
  if (!before.length && !after.length) return null

  return (
    <div className="mt-3 space-y-3">
      {before.length > 0 && <PhotoRow label="Before" urls={before} />}
      {after.length > 0 && <PhotoRow label="After" urls={after} />}
    </div>
  )
}
