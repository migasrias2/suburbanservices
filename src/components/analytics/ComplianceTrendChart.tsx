import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="4 8" stroke="#e2e8f0" />
          <XAxis
            dataKey="date"
            stroke="#94a3b8"
            tickLine={false}
            axisLine={false}
            dy={8}
            tickFormatter={toCompactDate}
          />
          <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} width={36} domain={[0, 100]} />
          <ChartTooltip
            content={<ChartTooltipContent indicator="line" className="!bg-white" />}
            cursor={false}
            labelFormatter={(value) => toCompactDate(String(value))}
          />
          <Line type="monotone" dataKey="compliance" stroke="#00339B" strokeWidth={3} dot={{ r: 4, stroke: '#0f3ccf', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#fff', stroke: '#00339B', strokeWidth: 3 }} />
        </LineChart>
      </ChartContainer>
    </AnalyticsChartCard>
  )
}
