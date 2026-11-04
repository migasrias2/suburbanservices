import React from 'react'
import { clsx } from 'clsx'
import { cn } from '@/lib/utils'

/** The small uppercase heading row every dashboard section opens with (house style, see AdminLiveDashboardPage). */
export const SectionHeading: React.FC<{ title: string; aside?: React.ReactNode; tone?: 'default' | 'warning' }> = ({
  title,
  aside,
  tone = 'default',
}) => (
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
    <h2
      className={cn(
        'text-xs font-semibold uppercase tracking-[0.2em]',
        tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      {title}
    </h2>
    {aside ? <div className="text-xs font-medium text-muted-foreground">{aside}</div> : null}
  </div>
)

export const EmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-3xl border border-dashed border-border bg-card/60 px-4 py-10 text-center text-sm text-muted-foreground">
    {children}
  </div>
)

export type PillTone = 'success' | 'warning' | 'info' | 'muted' | 'destructive'

const PILL_TONES: Record<PillTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/30 bg-info/10 text-info',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
}

export const StatusPill: React.FC<{ tone: PillTone; children: React.ReactNode; className?: string }> = ({
  tone,
  children,
  className,
}) => (
  // clsx, not cn: tailwind-merge does not know the custom text-caption2 size and
  // would drop it as a clash with the tone's text colour.
  <span
    className={clsx(
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-caption2 font-semibold',
      PILL_TONES[tone],
      className,
    )}
  >
    {children}
  </span>
)

/** A filter chip in the house FilterStrip style. */
export const FilterChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium transition',
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border bg-card text-muted-foreground hover:text-foreground',
    )}
  >
    {children}
  </button>
)
