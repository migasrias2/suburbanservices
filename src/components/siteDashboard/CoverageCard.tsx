import React from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatClock, pluralize } from '@/lib/siteDashboard/format'
import type { Coverage, CoverageItem } from '@/lib/siteDashboard/types'
import { EmptyState, SectionHeading } from './parts'

const TILE_TONE: Record<CoverageItem['status'], string> = {
  done: 'border-success/30 bg-success/10',
  in_progress: 'border-info/30 bg-info/10',
  not_yet: 'border-border bg-card',
}

const tileDetail = (item: CoverageItem): string => {
  if (item.status === 'in_progress') {
    return item.cleanCount ? `In progress · ${pluralize(item.cleanCount, 'clean')} done` : 'In progress'
  }
  if (item.status === 'done') {
    return item.cleanCount > 1 ? `${item.cleanCount} cleans · ${formatClock(item.lastCleanAt)}` : `Done ${formatClock(item.lastCleanAt)}`
  }
  return 'Not yet'
}

export const CoverageCard: React.FC<{ coverage: Coverage }> = ({ coverage }) => {
  const percent = coverage.total ? Math.round((coverage.done / coverage.total) * 100) : 0
  return (
    <section>
      <SectionHeading title="Site coverage today" aside={`${coverage.done} of ${pluralize(coverage.total, 'area')}`} />
      {!coverage.total ? (
        <EmptyState>No areas are set up for this site yet.</EmptyState>
      ) : (
        <div className="rounded-3xl border border-border bg-card p-4 sm:p-5">
          <Progress value={percent} className="mb-4 h-2" aria-label={`${percent}% of areas cleaned today`} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {coverage.items.map((item) => (
              <div key={item.key} className={cn('rounded-2xl border px-3 py-2.5', TILE_TONE[item.status])}>
                <div className="text-footnote font-semibold leading-snug text-foreground">{item.name}</div>
                <div className="mt-0.5 text-caption2 text-muted-foreground">{tileDetail(item)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
