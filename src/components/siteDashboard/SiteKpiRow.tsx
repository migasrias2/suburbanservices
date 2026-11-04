import React from 'react'
import { BellRing, CheckCircle2, Timer, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatClock, formatMinutes, pluralize } from '@/lib/siteDashboard/format'
import type { OnSiteCleaner, SiteKpis } from '@/lib/siteDashboard/types'

interface KpiCardProps {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  accent: string
  highlighted?: boolean
}

/** Same card as the admin live dashboard's StatCard, plus a detail line. */
const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, detail, accent, highlighted }) => (
  <div
    className={cn(
      'rounded-2xl border bg-card p-4 sm:rounded-3xl sm:p-5',
      highlighted ? 'border-warning/50 bg-warning/5 ring-1 ring-warning/30' : 'border-border',
    )}
  >
    <div className={cn('mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full sm:mb-3 sm:h-9 sm:w-9', accent)}>
      {icon}
    </div>
    <div className="text-caption2 uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</div>
    <div className="mt-1 text-title2 font-semibold leading-tight text-foreground sm:text-title1" data-numeric>
      {value}
    </div>
    <div className="mt-1 line-clamp-2 text-caption text-muted-foreground">{detail}</div>
  </div>
)

const onSiteDetail = (onSite: OnSiteCleaner[]): string => {
  if (!onSite.length) return 'Nobody clocked in'
  if (onSite.length === 1) return `${onSite[0].name} · since ${formatClock(onSite[0].clockIn)}`
  return onSite.map((person) => person.name.split(' ')[0]).join(', ')
}

export const SiteKpiRow: React.FC<{ kpis: SiteKpis; onSite: OnSiteCleaner[] }> = ({ kpis, onSite }) => {
  const cleansDetail = [
    kpis.inProgress ? `+${kpis.inProgress} in progress` : null,
    pluralize(kpis.photos, 'photo'),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      <KpiCard
        icon={<UserRound className="h-5 w-5" />}
        label="On site now"
        value={pluralize(kpis.onSiteCount, 'cleaner')}
        detail={onSiteDetail(onSite)}
        accent="bg-success/10 text-success"
      />
      <KpiCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        label="Cleans completed"
        value={String(kpis.cleansCompleted)}
        detail={cleansDetail}
        accent="bg-primary/10 text-primary"
      />
      <KpiCard
        icon={<BellRing className="h-5 w-5" />}
        label="Call a Cleaner"
        value={`${kpis.openCalls} open`}
        detail={`${kpis.resolvedToday} resolved today`}
        accent="bg-warning/10 text-warning"
        highlighted={kpis.openCalls > 0}
      />
      <KpiCard
        icon={<Timer className="h-5 w-5" />}
        label="Avg response"
        value={kpis.avgResponseMinutes === null ? '—' : formatMinutes(kpis.avgResponseMinutes)}
        detail={kpis.resolvedToday ? `Report to resolved, ${pluralize(kpis.resolvedToday, 'request')}` : 'No requests resolved today'}
        accent="bg-info/10 text-info"
      />
    </div>
  )
}
