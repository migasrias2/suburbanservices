import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type AnalyticsKpiCardProps = {
  title: string
  value: string
  subtitle?: string
  accentClassName?: string
  trend?: {
    delta: number
    label?: string
  }
}

export const AnalyticsKpiCard: React.FC<AnalyticsKpiCardProps> = ({
  title,
  value,
  subtitle,
  accentClassName = 'bg-[#00339B]/10 text-[#00339B]',
  trend,
}) => {
  return (
    <Card className="rounded-3xl border border-gray-100 bg-white shadow-sm">
      <CardHeader className="flex flex-col gap-1">
        <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-3xl font-semibold text-gray-900">{value}</div>
        {subtitle ? <p className="text-sm text-gray-500">{subtitle}</p> : null}
        {trend ? (
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              trend.delta >= 0
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-rose-50 text-rose-600'
            }`}
          >
            <span>{trend.delta >= 0 ? '▲' : '▼'}</span>
            <span>{Math.abs(trend.delta).toFixed(1)}%</span>
            {trend.label ? <span className="text-gray-500">{trend.label}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}






