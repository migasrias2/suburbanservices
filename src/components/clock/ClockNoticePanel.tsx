import React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Info, WifiOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClockNotice, NoticeTone } from '@/lib/clock/clockMessages'
import { Button } from '../ui/button'

/**
 * One clock message, big and persistent: it never disappears on a timer.
 * Errors stay until the cleaner acts. A sign-in action always goes to the
 * login screen; the other actions are handed to the screen.
 */
interface ClockNoticePanelProps {
  notice: ClockNotice
  onClockOut?: () => void
  onScanClockIn?: () => void
  /** Extra button, e.g. "Scan again". */
  secondary?: { label: string; onClick: () => void }
  onDismiss?: () => void
  className?: string
}

const TONE_STYLE: Record<NoticeTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  info: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const ToneIcon: React.FC<{ tone: NoticeTone }> = ({ tone }) => {
  const className = 'mt-0.5 h-5 w-5 shrink-0'
  if (tone === 'success') return <CheckCircle2 className={className} />
  if (tone === 'warning') return <WifiOff className={className} />
  if (tone === 'error') return <AlertCircle className={className} />
  return <Info className={className} />
}

export const ClockNoticePanel: React.FC<ClockNoticePanelProps> = ({
  notice,
  onClockOut,
  onScanClockIn,
  secondary,
  onDismiss,
  className,
}) => {
  const navigate = useNavigate()
  const action =
    notice.action === 'sign_in'
      ? { label: 'Sign in again', onClick: () => navigate('/login') }
      : notice.action === 'clock_out' && onClockOut
        ? { label: 'Clock out', onClick: onClockOut }
        : notice.action === 'scan_clock_in' && onScanClockIn
          ? { label: 'Scan Clock In', onClick: onScanClockIn }
          : null

  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={cn('w-full rounded-2xl border p-4 text-left', TONE_STYLE[notice.tone], className)}
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={notice.tone} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{notice.title}</p>
          {notice.body ? <p className="text-sm text-foreground/80">{notice.body}</p> : null}
          {notice.notes.map((note) => (
            <p key={note} className="text-sm text-foreground/70">
              {note}
            </p>
          ))}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss message"
            className="-m-1 shrink-0 rounded-full p-1 hover:bg-foreground/10"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {action || secondary ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {action ? (
            <Button onClick={action.onClick} className="rounded-full">
              {action.label}
            </Button>
          ) : null}
          {secondary ? (
            <Button variant="outline" onClick={secondary.onClick} className="rounded-full">
              {secondary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
