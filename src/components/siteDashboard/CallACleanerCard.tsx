import React from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatClockWithDay } from '@/lib/siteDashboard/format'
import { describeOpenCall, describeResolvedCall } from '@/lib/siteDashboard/callACleaner'
import type { CallItem } from '@/lib/siteDashboard/types'
import { EmptyState, SectionHeading, StatusPill } from './parts'

const CallRow: React.FC<{ call: CallItem; open: boolean; dayStart: Date }> = ({ call, open, dayStart }) => (
  <div
    className={cn(
      'flex items-start gap-3 rounded-2xl border p-3.5',
      open ? 'border-warning/40 bg-warning/5' : 'border-border bg-card',
    )}
  >
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        open ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
      )}
    >
      {open ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold text-foreground">{call.areaName ?? 'Area not recorded'}</div>
      {call.issue ? <div className="text-xs text-muted-foreground">{call.issue}</div> : null}
      <StatusPill tone={open ? 'warning' : 'success'} className="mt-1.5">
        {open ? describeOpenCall(call) : describeResolvedCall(call)}
      </StatusPill>
    </div>
    <time className="shrink-0 text-xs text-muted-foreground" dateTime={call.reportedAt}>
      {formatClockWithDay(call.reportedAt, dayStart)}
    </time>
  </div>
)

export const CallACleanerCard: React.FC<{ calls: { open: CallItem[]; resolved: CallItem[] }; dayStart: Date }> = ({ calls, dayStart }) => (
  <section>
    <SectionHeading
      title="Call a Cleaner"
      tone={calls.open.length ? 'warning' : 'default'}
      aside={`${calls.open.length} open · ${calls.resolved.length} resolved today`}
    />
    {!calls.open.length && !calls.resolved.length ? (
      <EmptyState>No Call a Cleaner requests today.</EmptyState>
    ) : (
      <div className="space-y-2.5">
        {calls.open.map((call) => (
          <CallRow key={call.id} call={call} open dayStart={dayStart} />
        ))}
        {calls.resolved.map((call) => (
          <CallRow key={call.id} call={call} open={false} dayStart={dayStart} />
        ))}
      </div>
    )}
  </section>
)
