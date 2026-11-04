import React from 'react'
import { AlertCircle, Check, LogIn, LogOut, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { describeOpenCall, describeResolvedCall } from '@/lib/siteDashboard/callACleaner'
import { formatClockWithDay, pluralize } from '@/lib/siteDashboard/format'
import type { SitePhoto, TimelineItem } from '@/lib/siteDashboard/types'
import { LazyPhotoGroup, type OpenPhotoHandler } from './LazyPhotoGroup'
import { StatusPill } from './parts'

const MARKER_TONE: Record<TimelineItem['kind'], string> = {
  clock_in: 'border-success text-success',
  clock_out: 'border-muted-foreground text-muted-foreground',
  clean: 'border-primary text-primary',
  in_progress: 'border-info bg-info text-info-foreground',
  call: 'border-warning text-warning',
}

const MarkerIcon: React.FC<{ kind: TimelineItem['kind'] }> = ({ kind }) => {
  const className = 'h-3 w-3'
  switch (kind) {
    case 'clock_in':
      return <LogIn className={className} />
    case 'clock_out':
      return <LogOut className={className} />
    case 'in_progress':
      return <Sparkles className={className} />
    case 'call':
      return <AlertCircle className={className} />
    case 'clean':
    default:
      return <Check className={className} />
  }
}

/** Start of the site's day, so anything older (an open request from last night) shows its date too. */
const DayStartContext = React.createContext<Date>(new Date(0))

const Heading: React.FC<{ at: string; title: string; pill?: React.ReactNode }> = ({ at, title, pill }) => {
  const dayStart = React.useContext(DayStartContext)
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <time className="min-w-[2.75rem] text-sm font-semibold text-primary" dateTime={at}>
        {formatClockWithDay(at, dayStart)}
      </time>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {pill}
    </div>
  )
}

const Body: React.FC<{ item: TimelineItem; photosById: Map<number, SitePhoto>; onOpenPhoto: OpenPhotoHandler }> = ({
  item,
  photosById,
  onOpenPhoto,
}) => {
  switch (item.kind) {
    case 'clock_in':
    case 'clock_out':
      return (
        <>
          <Heading at={item.at} title={item.kind === 'clock_in' ? 'Clocked in' : 'Clocked out'} />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.cleanerName} {item.kind === 'clock_in' ? 'arrived on site.' : 'left the site.'}
          </p>
        </>
      )
    case 'in_progress':
      return (
        <>
          <Heading at={item.at} title={item.areaName} pill={<StatusPill tone="info">In progress</StatusPill>} />
          <p className="mt-0.5 text-xs text-muted-foreground">{item.cleanerName} started cleaning.</p>
        </>
      )
    case 'call': {
      const open = item.call.status !== 'resolved'
      return (
        <>
          <Heading
            at={item.at}
            title={`Call a Cleaner · ${item.call.areaName ?? 'Area not recorded'}`}
            pill={<StatusPill tone={open ? 'warning' : 'success'}>{open ? 'Open' : 'Resolved'}</StatusPill>}
          />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[item.call.issue, open ? describeOpenCall(item.call) : describeResolvedCall(item.call)].filter(Boolean).join('. ')}
          </p>
        </>
      )
    }
    case 'clean':
    default: {
      const { clean } = item
      const photos = clean.photoIds.flatMap((id) => {
        const photo = photosById.get(id)
        return photo ? [photo] : []
      })
      return (
        <>
          <Heading
            at={item.at}
            title={clean.areaName ?? 'Area not recorded'}
            pill={<StatusPill tone="success">Completed</StatusPill>}
          />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[clean.cleanerName, clean.taskCount ? pluralize(clean.taskCount, 'task') : null, photos.length ? pluralize(photos.length, 'photo') : 'No photos']
              .filter(Boolean)
              .join(' · ')}
          </p>
          {clean.tasks.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Checklist">
              {clean.tasks.map((task) => (
                <li key={task} className="rounded-full bg-secondary px-2.5 py-0.5 text-caption2 text-secondary-foreground">
                  <Check className="mr-1 inline h-3 w-3 text-success" aria-hidden />
                  {task}
                </li>
              ))}
            </ul>
          ) : null}
          {photos.length ? (
            <div className="mt-2">
              <LazyPhotoGroup photos={photos} onOpen={onOpenPhoto} layout="strip" />
            </div>
          ) : null}
        </>
      )
    }
  }
}

export const TimelineEntry: React.FC<{
  item: TimelineItem
  photosById: Map<number, SitePhoto>
  onOpenPhoto: OpenPhotoHandler
  dayStart: Date
}> = ({ item, photosById, onOpenPhoto, dayStart }) => (
  <DayStartContext.Provider value={dayStart}>
  <li className="relative pb-5 pl-7 last:pb-0">
    <span
      className={cn(
        'absolute -left-[0.6875rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-card',
        MARKER_TONE[item.kind],
      )}
      aria-hidden
    >
      <MarkerIcon kind={item.kind} />
    </span>
    <Body item={item} photosById={photosById} onOpenPhoto={onOpenPhoto} />
  </li>
  </DayStartContext.Provider>
)
