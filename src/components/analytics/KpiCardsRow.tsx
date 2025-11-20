import React, { useMemo } from 'react'
import { AnalyticsSummary } from '@/services/analyticsService'
import { AnalyticsKpiCard } from './AnalyticsKpiCard'

const formatPercent = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

const formatHours = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} hrs`
}

export const KpiCardsRow: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  const {
    totals: { complianceRate, onTimeRate, photoComplianceRate, totalHoursWorked },
  } = summary

  const hoursBreakdown = useMemo(() => {
    const sites = new Map<string, { name: string; totalHours: number; cleaners: Map<string, number> }>()

    summary.hoursByDate?.forEach((day) => {
      if (!day.details) return
      day.details.forEach((detail) => {
        const siteName = detail.siteName || 'Unknown Site'
        if (!sites.has(siteName)) {
          sites.set(siteName, { name: siteName, totalHours: 0, cleaners: new Map() })
        }
        const site = sites.get(siteName)!
        site.totalHours += detail.hours

        const cleanerName = detail.cleanerName || 'Unknown Cleaner'
        const currentCleanerHours = site.cleaners.get(cleanerName) ?? 0
        site.cleaners.set(cleanerName, currentCleanerHours + detail.hours)
      })
    })

    return Array.from(sites.values())
      .sort((a, b) => b.totalHours - a.totalHours)
      .map((site) => ({
        ...site,
        cleaners: Array.from(site.cleaners.entries())
          .map(([name, hours]) => ({ name, hours }))
          .sort((a, b) => b.hours - a.hours),
      }))
  }, [summary.hoursByDate])

  const hoursHoverContent =
    hoursBreakdown.length > 0 ? (
      <div className="flex flex-col max-h-[400px]">
        <div className="sticky top-0 z-10 border-b bg-slate-50 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-900">Hours by Site</h4>
        </div>
        <div className="overflow-y-auto p-2 custom-scrollbar">
          {hoursBreakdown.map((site) => (
            <div key={site.name} className="mb-2 last:mb-0 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-slate-700 text-sm truncate max-w-[180px]" title={site.name}>
                  {site.name}
                </span>
                <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {site.totalHours.toFixed(1)}h
                </span>
              </div>
              <div className="space-y-1 pl-1">
                {site.cleaners.map((cleaner) => (
                  <div key={cleaner.name} className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate max-w-[180px]" title={cleaner.name}>
                      {cleaner.name}
                    </span>
                    <span className="font-mono shrink-0 ml-2">{cleaner.hours.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AnalyticsKpiCard
        title="Overall Compliance"
        value={formatPercent(complianceRate)}
        subtitle="Shifts completed end-to-end"
      />
      <AnalyticsKpiCard
        title="On-Time Clock-Ins"
        value={formatPercent(onTimeRate)}
        subtitle="Punctual starts vs scheduled"
      />
      <AnalyticsKpiCard
        title="Photo Compliance"
        value={formatPercent(photoComplianceRate)}
        subtitle="Tasks submitted with photos"
      />
      <AnalyticsKpiCard
        title="Total Hours Worked"
        value={formatHours(totalHoursWorked)}
        subtitle="Aggregated across cleaners"
        hoverContent={hoursHoverContent}
      />
    </div>
  )
}
