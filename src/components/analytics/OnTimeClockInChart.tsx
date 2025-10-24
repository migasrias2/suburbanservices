import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { AnalyticsChartCard } from './AnalyticsChartCard'

export const OnTimeClockInChart: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  const data = summary.onTimeByCleaner.map((item) => ({
    cleaner: item.cleanerName || 'Cleaner',
    rate: item.rate,
  }))

  return (
    <AnalyticsChartCard
      title="On-Time Clock-Ins"
      description="Punctuality across cleaners"
    >
      <ChartContainer
        config={{
          rate: {
            label: 'On-Time %',
            color: '#2563eb',
          },
        }}
        className="h-72"
      >
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="4 8" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="cleaner" stroke="#94a3b8" tickLine={false} axisLine={false} dy={8} interval={0} angle={-18} textAnchor="end" height={70} />
          <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} width={36} domain={[0, 100]} />
          <ChartTooltip
            content={<ChartTooltipContent indicator="line" className="!bg-white" />}
            cursor={{ fill: 'rgba(37, 99, 235, 0.12)' }}
          />
          <Bar dataKey="rate" radius={[16, 16, 12, 12]} fill="var(--color-rate)" />
        </BarChart>
      </ChartContainer>
    </AnalyticsChartCard>
  )
}
