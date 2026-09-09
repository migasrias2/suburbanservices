import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

export type AnalyticsKpiCardProps = {
  title: string
  value: string
  subtitle?: string
  accentClassName?: string
  trend?: {
    delta: number
    label?: string
  }
  hoverContent?: React.ReactNode
}

export const AnalyticsKpiCard: React.FC<AnalyticsKpiCardProps> = ({
  title,
  value,
  subtitle,
  accentClassName = 'bg-primary/10 text-primary',
  trend,
  hoverContent,
}) => {
  const cardContent = (
    <Card
      className={cn(
        'rounded-3xl border border-border bg-card shadow-sm transition-all',
        hoverContent && 'cursor-help hover:shadow-md hover:border-border'
      )}
    >
      <CardHeader className="flex flex-col gap-1">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-3xl font-semibold text-foreground">{value}</div>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        {trend ? (
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              trend.delta >= 0
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            <span>{trend.delta >= 0 ? '▲' : '▼'}</span>
            <span>{Math.abs(trend.delta).toFixed(1)}%</span>
            {trend.label ? <span className="text-muted-foreground">{trend.label}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )

  if (hoverContent) {
    return (
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>
          {cardContent}
        </HoverCardTrigger>
        <HoverCardContent className="w-80 p-0" align="start" side="bottom">
          {hoverContent}
        </HoverCardContent>
      </HoverCard>
    )
  }

  return cardContent
}
