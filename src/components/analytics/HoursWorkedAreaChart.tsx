import { TrendingUp } from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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

export const HoursWorkedAreaChart: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  const data = summary.hoursByDate.map((point) => ({
    date: point.date,
    hours: point.hours,
  }))

  return (
    <AnalyticsChartCard
      title="Total Hours Worked"
      description="Daily hours logged across cleaners"
      footer={
        <div className="rounded-[24px] bg-blue-50/60 px-4 py-3 text-sm text-[#00339B]">
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            Daily trend across the selected range
            <TrendingUp className="h-4 w-4" />
          </div>
          <p className="mt-1 text-xs text-[#1f3c88]">
            Shows total hours from attendance records grouped by day for the chosen date window.
          </p>
        </div>
      }
    >
      <ChartContainer config={chartConfig} className="h-72">
        <AreaChart data={data} margin={{ left: 12, right: 12, bottom: 8 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            stroke="#94a3b8"
            minTickGap={24}
            tickFormatter={toCompactDate}
          />
          <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} width={48} />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent indicator="line" className="!bg-white" labelFormatter={(value) => toCompactDate(String(value))} />}
          />
          <Area
            dataKey="hours"
            type="natural"
            stroke="var(--color-hours)"
            fill="var(--color-hours)"
            fillOpacity={0.3}
          />
        </AreaChart>
      </ChartContainer>
    </AnalyticsChartCard>
  )
}
