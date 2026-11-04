import React from 'react'
import { formatClock, formatMinutes, initials } from '@/lib/siteDashboard/format'
import type { OnSiteCleaner } from '@/lib/siteDashboard/types'
import { EmptyState, SectionHeading, StatusPill } from './parts'

const ActivityLine: React.FC<{ person: OnSiteCleaner }> = ({ person }) => {
  const activity = person.activity
  if (!activity) return null
  if (activity.kind === 'cleaning') {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-info/10 px-3.5 py-2.5">
        <div className="min-w-0 text-sm">
          <div className="text-caption2 uppercase tracking-wider text-muted-foreground">Currently cleaning</div>
          <span className="font-semibold text-foreground">{activity.areaName}</span>
          <span className="text-muted-foreground"> · since {formatClock(activity.since)}</span>
        </div>
        <StatusPill tone="info">In progress</StatusPill>
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-2xl bg-muted px-3.5 py-2.5 text-sm">
      <div className="text-caption2 uppercase tracking-wider text-muted-foreground">Last cleaned</div>
      <span className="font-semibold text-foreground">{activity.areaName ?? 'Area not recorded'}</span>
      <span className="text-muted-foreground"> · {formatClock(activity.at)}</span>
    </div>
  )
}

export const OnSiteCard: React.FC<{ onSite: OnSiteCleaner[] }> = ({ onSite }) => (
  <section>
    <SectionHeading title="Who is on site" aside={<StatusPill tone={onSite.length ? 'success' : 'muted'}>{onSite.length} on site</StatusPill>} />
    {!onSite.length ? (
      <EmptyState>No cleaners are clocked in at this site right now.</EmptyState>
    ) : (
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {onSite.map((person, index) => (
          <div key={person.key} className={`px-4 py-4 sm:px-5 ${index > 0 ? 'border-t border-border' : ''}`}>
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {initials(person.name)}
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-success" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-medium text-foreground">{person.name}</div>
                <div className="text-xs text-muted-foreground">
                  Clocked in {formatClock(person.clockIn)} · {formatMinutes(person.minutesOnSite)} on site
                </div>
              </div>
            </div>
            <ActivityLine person={person} />
          </div>
        ))}
      </div>
    )}
  </section>
)
