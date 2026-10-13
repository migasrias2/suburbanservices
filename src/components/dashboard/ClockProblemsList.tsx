import React from 'react'
import type { ClockFailureEntry } from '@/services/shiftReviewService'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Clock-ins and clock-outs that did not go through, so "it didn't work" can be checked. */
export function ClockProblemsList({ failures }: { failures: ClockFailureEntry[] }) {
  if (!failures.length) return null

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-destructive">Clock problems · last 7 days</h2>
        <span className="text-xs font-medium text-muted-foreground">{failures.length}</span>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {failures.map((f, idx) => (
          <div key={f.id} className={`px-4 py-3 sm:px-5 ${idx > 0 ? 'border-t border-border' : ''}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{f.cleanerName ?? 'Unknown'}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {f.eventType === 'clock_in' ? 'Clock-in failed' : 'Clock-out failed'}
              {f.customerName ? ` · ${f.customerName}` : ''}
              {f.hasLocation === false ? ' · no location' : ''}
            </div>
            <p className="mt-1 text-xs leading-snug text-destructive">{f.reason}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
