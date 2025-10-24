import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { cn, defaultAnalyticsRange, toIsoRange, type DateRange } from '@/lib/utils'
import { fetchAnalyticsSummary, type AnalyticsSummary, type AnalyticsRole } from '@/services/analyticsService'
import { KpiCardsRow } from './KpiCardsRow'
import { ComplianceTrendChart } from './ComplianceTrendChart'
import { OnTimeClockInChart } from './OnTimeClockInChart'
import { PhotoCompliancePieChart } from './PhotoCompliancePieChart'
import { HoursWorkedAreaChart } from './HoursWorkedAreaChart'

const AnalyticsContent: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  return (
    <div className="space-y-8">
      <KpiCardsRow summary={summary} />
      <div className="grid gap-6 xl:grid-cols-2">
        <ComplianceTrendChart summary={summary} />
        <OnTimeClockInChart summary={summary} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <PhotoCompliancePieChart summary={summary} />
        <HoursWorkedAreaChart summary={summary} />
      </div>
    </div>
  )
}

export type AnalyticsDashboardProps = {
  managerId: string | null
  role: AnalyticsRole
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ managerId, role }) => {
  const [range, setRange] = useState<DateRange>(defaultAnalyticsRange())
  const isoRange = useMemo(() => toIsoRange(range), [range])

  const query = useQuery({
    queryKey: ['analytics-summary', role, managerId, isoRange.start, isoRange.end],
    queryFn: () =>
      fetchAnalyticsSummary({
        managerId,
        role,
        range: isoRange,
      }),
  })

  const handleSelectRange = (selected: Date | { from?: Date; to?: Date } | undefined) => {
    if (!selected) return
    if (selected instanceof Date) {
      const start = new Date(selected)
      start.setHours(0, 0, 0, 0)
      const end = new Date(selected)
      end.setHours(23, 59, 59, 999)
      setRange({ start, end })
      return
    }
    if (selected.from && selected.to) {
      const start = new Date(selected.from)
      start.setHours(0, 0, 0, 0)
      const end = new Date(selected.to)
      end.setHours(23, 59, 59, 999)
      setRange({ start, end })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-[#00339B]">Analytics</h1>
          <p className="text-sm text-gray-500">
            {role === 'admin'
              ? 'Monitoring performance across all cleaners'
              : 'Focused insights for your cleaner team'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'flex items-center gap-2 rounded-full border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-[#00339B] shadow-sm hover:bg-blue-50',
                )}
              >
                <CalendarIcon className="h-4 w-4" />
                <span>
                  {`${format(range.start, 'MMM d, yyyy')} - ${format(range.end, 'MMM d, yyyy')}`}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={{ from: range.start, to: range.end }}
                onSelect={handleSelectRange}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-blue-200 bg-blue-50/40 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[#00339B]" />
          <p className="mt-3 text-sm font-medium text-[#00339B]">Loading analytics...</p>
        </div>
      ) : query.isError ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          Unable to load analytics right now. Please try again later.
        </div>
      ) : query.data ? (
        <AnalyticsContent summary={query.data} />
      ) : (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          No analytics available for the selected range.
        </div>
      )}
    </div>
  )
}
