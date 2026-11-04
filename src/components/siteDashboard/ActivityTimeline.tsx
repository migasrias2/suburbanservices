import React, { useMemo, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FilterStrip } from '@/components/layout/PageHeader'
import { filterTimeline, type TimelineFilter, type TimelineOrder } from '@/lib/siteDashboard/timeline'
import type { SitePhoto, TimelineItem } from '@/lib/siteDashboard/types'
import type { OpenPhotoHandler } from './LazyPhotoGroup'
import { EmptyState, FilterChip, SectionHeading } from './parts'
import { TimelineEntry } from './TimelineEntry'

const PAGE_SIZE = 25
const ALL_AREAS = '__all__'

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'cleans', label: 'Cleans' },
  { value: 'calls', label: 'Call a Cleaner' },
  { value: 'photos', label: 'With photos' },
]

interface ActivityTimelineProps {
  items: TimelineItem[]
  areaOptions: Array<{ key: string; name: string }>
  photos: SitePhoto[]
  onOpenPhoto: OpenPhotoHandler
  dayStart: Date
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ items, areaOptions, photos, onOpenPhoto, dayStart }) => {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [areaKey, setAreaKey] = useState<string | null>(null)
  // Newest first: on a live view the first page should be what just happened.
  const [order, setOrder] = useState<TimelineOrder>('newest')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // An area that drops out of today's list (e.g. the site changed) must not leave a filter nobody can see.
  const activeAreaKey = areaKey && areaOptions.some((option) => option.key === areaKey) ? areaKey : null
  const photosById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos])
  const visible = useMemo(
    () => filterTimeline(items, { filter, areaKey: activeAreaKey, order }),
    [items, filter, activeAreaKey, order],
  )
  const shown = visible.slice(0, visibleCount)

  const resetPaging = () => setVisibleCount(PAGE_SIZE)

  return (
    <section>
      <SectionHeading title="Activity timeline" aside={`${visible.length} of ${items.length}`} />
      <FilterStrip className="mb-3">
        {FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            active={filter === option.value}
            onClick={() => {
              setFilter(option.value)
              resetPaging()
            }}
          >
            {option.label}
          </FilterChip>
        ))}
      </FilterStrip>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={activeAreaKey ?? ALL_AREAS}
          onValueChange={(value) => {
            setAreaKey(value === ALL_AREAS ? null : value)
            resetPaging()
          }}
        >
          <SelectTrigger className="h-9 w-full rounded-full sm:w-64" aria-label="Filter by area">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_AREAS}>All areas</SelectItem>
            {areaOptions.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-full"
          onClick={() => setOrder((current) => (current === 'oldest' ? 'newest' : 'oldest'))}
        >
          <ArrowDownUp className="mr-1.5 h-4 w-4" />
          {order === 'oldest' ? 'Oldest first' : 'Newest first'}
        </Button>
      </div>

      {!shown.length ? (
        <EmptyState>{items.length ? 'Nothing matches these filters.' : 'No activity at this site yet today.'}</EmptyState>
      ) : (
        <div className="rounded-3xl border border-border bg-card px-4 py-5 sm:px-6">
          <ol className="ml-2.5 border-l-2 border-border">
            {shown.map((item) => (
              <TimelineEntry key={item.id} item={item} photosById={photosById} onOpenPhoto={onOpenPhoto} dayStart={dayStart} />
            ))}
          </ol>
          {visible.length > shown.length ? (
            <div className="mt-4 flex justify-center">
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, visible.length - shown.length)} more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
