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

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AnalyticsKpiCard title="Overall Compliance" value={formatPercent(complianceRate)} subtitle="Shifts completed end-to-end" />
      <AnalyticsKpiCard title="On-Time Clock-Ins" value={formatPercent(onTimeRate)} subtitle="Punctual starts vs scheduled" />
      <AnalyticsKpiCard title="Photo Compliance" value={formatPercent(photoComplianceRate)} subtitle="Tasks submitted with photos" />
      <AnalyticsKpiCard title="Total Hours Worked" value={formatHours(totalHoursWorked)} subtitle="Aggregated across cleaners" />
    </div>
  )
}
