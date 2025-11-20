import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Area, AreaChart, CartesianGrid, Label, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { AnalyticsChartCard } from './AnalyticsChartCard'

const chartConfig = {
  hours: {
    label: 'Hours Worked',
    color: '#00339B',
  },
} satisfies ChartConfig

const toCompactDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const hoursFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

const normalizeToIsoDay = (value?: string | Date | null): string | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const expandDateRange = (dates: string[]): string[] => {
  if (!dates.length) return []
  const sorted = [...dates].sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  const start = new Date(sorted[0])
  const end = new Date(sorted[sorted.length - 1])

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return sorted
  }

  const result: string[] = []
  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    const currentIso = normalizeToIsoDay(new Date(current))
    if (currentIso) {
      result.push(currentIso)
    }
  }

  return result
}

type HoursWorkedAreaChartProps = {
  summary: AnalyticsSummary
  layout?: 'card' | 'inline'
  className?: string
}

type CleanerSiteHours = {
  cleanerName: string
  siteName: string
  hours: number
}

type HoursWorkedChartProps = {
  data: Array<{ date: string; hours: number; details?: CleanerSiteHours[] }>
  containerClassName?: string
  margin?: { top: number; right: number; bottom: number; left: number }
  xAxisHeight?: number
  yAxisWidth?: number
  labelOffset?: number
}

const HoursWorkedChart: React.FC<HoursWorkedChartProps> = ({
  data,
  containerClassName = 'h-72',
  margin = { top: 24, right: 24, left: 16, bottom: 24 },
  xAxisHeight = 56,
  yAxisWidth = 64,
  labelOffset = -16,
}) => (
  <ChartContainer config={chartConfig} className={containerClassName}>
    <AreaChart
      data={data}
      margin={margin}
    >
      <CartesianGrid vertical={false} stroke="#d7e3f8" strokeDasharray="3 6" />
      <XAxis
        dataKey="date"
        tickLine={false}
        axisLine={false}
        tickMargin={12}
        stroke="#94a3b8"
        minTickGap={24}
        tickFormatter={toCompactDate}
        fontSize={12}
        height={xAxisHeight}
      />
      <YAxis
        stroke="#94a3b8"
        tickLine={false}
        axisLine={false}
        width={yAxisWidth}
        tickMargin={8}
        tickFormatter={(value) => `${value}h`}
        fontSize={12}
      >
        <Label
          value="hrs"
          position="insideLeft"
          offset={labelOffset}
          className="fill-slate-400 text-xs"
        />
      </YAxis>
      <ChartTooltip
        cursor={{ stroke: 'var(--color-hours)', strokeOpacity: 0.25, strokeWidth: 1, strokeDasharray: '3 3' }}
        content={
          <ChartTooltipContent
            indicator="line"
            className="!bg-white"
            labelFormatter={(value) => toCompactDate(String(value))}
            formatter={(value, name, item, index, payload: any) => {
              const numericValue = typeof value === 'number' ? value : Number(value)
              const details = payload?.details || []

              return (
                <div className="flex min-w-[220px] flex-col gap-3">
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="text-xs font-medium text-gray-500">Hours Worked</span>
                    <span className="font-mono font-semibold text-[#00339B]">
                      {Number.isFinite(numericValue) ? `${hoursFormatter.format(numericValue)}h` : '0h'}
                    </span>
                  </div>
                  {details.length > 0 && (
                    <div className="mt-1 flex flex-col gap-2 border-t border-slate-100 pt-3">
                      <span className="text-xs font-medium text-slate-400">Breakdown</span>
                      <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                        {details.map((d: CleanerSiteHours, i: number) => (
                          <div key={i} className="flex flex-col rounded-md bg-slate-50 p-2 text-xs">
                            <div className="flex justify-between gap-2">
                              <span className="truncate font-medium text-slate-700">{d.cleanerName}</span>
                              <span className="shrink-0 font-mono text-slate-600">{d.hours.toFixed(1)}h</span>
                            </div>
                            <span className="truncate text-[10px] text-slate-400">{d.siteName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            }}
          />
        }
      />
      <Area
        dataKey="hours"
        type="monotone"
        stroke="var(--color-hours)"
        fill="var(--color-hours)"
        fillOpacity={0.22}
        dot={{ r: 3, fill: '#00339B', stroke: '#fff', strokeWidth: 2 }}
        activeDot={{ r: 5, fill: '#00339B', stroke: '#fff', strokeWidth: 3 }}
      />
    </AreaChart>
  </ChartContainer>
)

export const HoursWorkedAreaChart: React.FC<HoursWorkedAreaChartProps> = ({ summary, layout = 'card', className }) => {
  const hoursByDay = new Map<string, { hours: number; details: CleanerSiteHours[] }>()
  summary.hoursByDate.forEach((point) => {
    const normalized = normalizeToIsoDay(point.date)
    if (normalized) {
      hoursByDay.set(normalized, { hours: point.hours, details: point.details || [] })
    }
  })

  const candidateDates = [
    ...summary.trend.flatMap((point) => {
      const normalized = normalizeToIsoDay(point.date)
      return normalized ? [normalized] : []
    }),
    ...summary.hoursByDate.flatMap((point) => {
      const normalized = normalizeToIsoDay(point.date)
      return normalized ? [normalized] : []
    }),
  ]

  const orderedDates = candidateDates.length
    ? expandDateRange(Array.from(new Set(candidateDates)))
    : Array.from(hoursByDay.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())

  const data = orderedDates.length
    ? orderedDates.map((date) => {
        const entry = hoursByDay.get(date)
        return {
          date,
          hours: entry?.hours ?? 0,
          details: entry?.details ?? [],
        }
      })
    : summary.hoursByDate.map((point) => ({
        date: point.date,
        hours: point.hours,
        details: point.details || [],
      }))

  const totalHours = summary.totals.totalHoursWorked ?? data.reduce((total, point) => total + point.hours, 0)
  const averageDailyHours = data.length ? totalHours / data.length : 0
  const peakDay = data.reduce<HoursWorkedChartProps['data'][number] | null>((highest, current) => {
    if (!highest) return current
    return current.hours > highest.hours ? current : highest
  }, null)

  if (layout === 'inline') {
    return (
      <div className={cn('rounded-[24px] border border-blue-100 bg-white/80 p-4 shadow-sm', className)}>
        <HoursWorkedChart
          data={data}
          containerClassName="h-64"
          margin={{ top: 20, right: 20, left: 14, bottom: 16 }}
          xAxisHeight={48}
          yAxisWidth={60}
          labelOffset={-14}
        />
      </div>
    )
  }

  return (
    <AnalyticsChartCard
      title="Hours Worked"
      description="Cleaner coverage across the selected range"
      footer={
        peakDay
          ? `Peak day ${toCompactDate(peakDay.date)} with ${hoursFormatter.format(peakDay.hours)}h captured.`
          : undefined
      }
      className={className}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 text-sm text-gray-600">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-gray-400">Total hours</span>
            <span className="text-xl font-semibold text-[#00339B]">{hoursFormatter.format(totalHours)}h</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-xs uppercase tracking-wide text-gray-400">Avg / day</span>
            <span className="text-xl font-semibold text-[#00339B]">{hoursFormatter.format(averageDailyHours)}h</span>
          </div>
        </div>
        <HoursWorkedChart data={data} />
      </div>
    </AnalyticsChartCard>
  )
}
