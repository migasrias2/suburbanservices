import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Line, LineChart, CartesianGrid, Label, XAxis, YAxis } from 'recharts'
import { AnalyticsChartCard } from './AnalyticsChartCard'

const toCompactDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export const ComplianceTrendChart: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  const data = summary.trend.map((point) => ({
    date: point.date,
    compliance: point.compliance,
  }))

  return (
    <AnalyticsChartCard
      title="Compliance Trend"
      description="Daily completion rate across the selected range"
    >
      <ChartContainer
        config={{
          compliance: {
            label: 'Compliance %',
            color: '#00339B',
          },
        }}
        className="h-72"
      >
        <LineChart
          data={data}
          margin={{ top: 24, right: 32, left: 16, bottom: 24 }}
        >
          <CartesianGrid strokeDasharray="3 6" stroke="#d7e3f8" horizontal={true} vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#94a3b8"
            tickLine={false}
            axisLine={false}
            dy={12}
            height={60}
            minTickGap={28}
            tickMargin={12}
            tickFormatter={toCompactDate}
            fontSize={12}
          />
          <YAxis
            stroke="#94a3b8"
            tickLine={false}
            axisLine={false}
            width={56}
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            tickMargin={8}
            fontSize={12}
          >
            <Label
              value="%"
              position="insideLeft"
              offset={-12}
              className="fill-slate-400 text-xs"
            />
          </YAxis>
          <ChartTooltip
            content={<ChartTooltipContent indicator="line" className="!bg-white" />}
            cursor={false}
            labelFormatter={(value) => toCompactDate(String(value))}
          />
          <Line
            type="monotone"
            dataKey="compliance"
            stroke="#00339B"
            strokeWidth={3}
            dot={{ r: 4, fill: '#fff', stroke: '#00339B', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: '#fff', stroke: '#00339B', strokeWidth: 3 }}
          />
        </LineChart>
      </ChartContainer>
    </AnalyticsChartCard>
  )
}
