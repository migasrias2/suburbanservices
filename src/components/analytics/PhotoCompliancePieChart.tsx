import { TrendingUp } from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AnalyticsSummary } from '@/services/analyticsService'
import { Pie, PieChart, Cell } from 'recharts'
import { AnalyticsChartCard } from './AnalyticsChartCard'

const chartConfig = {
  total: {
    label: 'Tasks',
  },
  withPhoto: {
    label: 'With Photo',
    color: '#00339B',
  },
  withoutPhoto: {
    label: 'Without Photo',
    color: '#dbe7ff',
  },
} satisfies ChartConfig

const formatPercent = (value: number, total: number) => {
  if (!total) return '0%'
  return `${((value / total) * 100).toFixed(1)}%`
}

export const PhotoCompliancePieChart: React.FC<{ summary: AnalyticsSummary }> = ({ summary }) => {
  const withPhoto = summary.photoComplianceBreakdown.withPhoto
  const withoutPhoto = summary.photoComplianceBreakdown.withoutPhoto
  const total = withPhoto + withoutPhoto

  const withPhotoPercent = formatPercent(withPhoto, total)
  const withoutPhotoPercent = formatPercent(withoutPhoto, total)

  const data = [
    { name: 'With Photo', value: withPhoto, fill: 'var(--color-withPhoto)' },
    { name: 'Without Photo', value: withoutPhoto, fill: 'var(--color-withoutPhoto)' },
  ]

  const chartColors = [chartConfig.withPhoto.color!, chartConfig.withoutPhoto.color!]

  return (
    <AnalyticsChartCard
      title="Photo Compliance"
      description="Tasks submitted with required photos"
    >
      <div className="grid gap-4">
        <div className="flex flex-col gap-2 px-2 text-sm text-gray-600 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="font-semibold text-[#00339B]">{withPhotoPercent} with photos</div>
          <div className="text-gray-500 whitespace-nowrap">{withoutPhotoPercent} missing photos</div>
        </div>
        <ChartContainer
          config={chartConfig}
          className="mx-auto h-[260px] w-full max-w-[320px] pb-0 [&_.recharts-pie-label-text]:fill-gray-600 [&_.recharts-pie-label-text]:font-semibold"
        >
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent indicator="line" nameKey="name" hideLabel className="!bg-white" />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={8}
              cornerRadius={16}
              labelLine={false}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex flex-col gap-1 rounded-[24px] bg-blue-50/60 px-4 py-3 text-sm text-[#00339B]">
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            Coverage trend {total > 0 ? withPhotoPercent : '0%'}
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="text-xs text-[#1f3c88]">
            Showing distribution of {total} task submissions with and without required photos for the selected period.
          </div>
        </div>
      </div>
    </AnalyticsChartCard>
  )
}
