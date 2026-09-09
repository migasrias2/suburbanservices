import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { normalizeCleanerName } from '@/lib/identity'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import { AnalyticsChartCard } from './AnalyticsChartCard'

export const OnTimeClockInChart: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  const normalizeKey = (value?: string | null) => normalizeCleanerName(value).toLowerCase()

  const byId = new Map(summary.onTimeByCleaner.map((item) => [item.cleanerId, item]))
  const byName = new Map(summary.onTimeByCleaner.map((item) => [normalizeKey(item.cleanerName), item]))

  const seen = new Set<string>()

  const rosterBackedData = summary.roster.map((cleaner) => {
    const displayName = normalizeCleanerName(`${cleaner.first_name ?? ''} ${cleaner.last_name ?? ''}`)
    const normalizedName = normalizeKey(displayName)

    const matchById = cleaner.id ? byId.get(cleaner.id) : undefined
    const matchByName = byName.get(normalizedName)
    const record = matchById ?? matchByName

    seen.add(matchById?.cleanerId ?? matchByName?.cleanerId ?? normalizedName)

    return {
      cleaner: displayName,
      rate: record?.rate ?? 0,
    }
  })

  const unmatchedData = summary.onTimeByCleaner
    .filter((item) => {
      const key = item.cleanerId || normalizeKey(item.cleanerName)
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((item) => ({
      cleaner: normalizeCleanerName(item.cleanerName),
      rate: item.rate,
    }))

  const data = (rosterBackedData.length ? rosterBackedData : unmatchedData).concat(
    rosterBackedData.length ? unmatchedData : [],
  )

  return (
    <AnalyticsChartCard
      title="On-Time Clock-Ins"
      description="Punctuality across cleaners"
    >
      <ChartContainer
        config={{
          rate: {
            label: 'On-Time %',
            color: 'hsl(var(--chart-1))',
          },
        }}
        className="h-72"
      >
        <BarChart
          data={data}
          margin={{ top: 24, right: 32, left: 32, bottom: 48 }}
        >
          <CartesianGrid strokeDasharray="4 8" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="cleaner"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            dy={8}
            interval={0}
            angle={-18}
            textAnchor="end"
            height={70}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
          />
          <ChartTooltip
            content={<ChartTooltipContent indicator="line" className="!bg-card" />}
            cursor={{ fill: 'rgba(37, 99, 235, 0.12)' }}
          />
          <Bar
            dataKey="rate"
            radius={[16, 16, 12, 12]}
            fill="var(--color-rate)"
            activeBar={{
              fill: 'rgba(59, 130, 246, 0.55)',
              stroke: 'hsl(var(--chart-1))',
              strokeWidth: 2,
            }}
          >
            <LabelList
              dataKey="rate"
              position="top"
              formatter={(value: number) => `${value}%`}
              fill="hsl(var(--foreground))"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </AnalyticsChartCard>
  )
}
