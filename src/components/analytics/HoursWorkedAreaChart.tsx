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

type HoursWorkedAreaChartProps = {
  summary: AnalyticsSummary
  layout?: 'card' | 'inline'
  className?: string
}

type HoursWorkedChartProps = {
  data: Array<{ date: string; hours: number }>
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
        cursor={false}
        content={<ChartTooltipContent indicator="line" className="!bg-white" labelFormatter={(value) => toCompactDate(String(value))} />}
      />
      <Area
        dataKey="hours"
        type="natural"
        stroke="var(--color-hours)"
        fill="var(--color-hours)"
        fillOpacity={0.22}
      />
    </AreaChart>
  </ChartContainer>
)

export const HoursWorkedAreaChart: React.FC<HoursWorkedAreaChartProps> = ({ summary, layout = 'card', className }) => {
  const data = summary.hoursByDate.map((point) => ({
    date: point.date,
    hours: point.hours,
  }))

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
      className={className}
    >
      <HoursWorkedChart data={data} />
    </AnalyticsChartCard>
  )
}
