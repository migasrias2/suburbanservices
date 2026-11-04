import React from 'react'
import { dismissDroppedScans, type ClockView } from '@/lib/clock/clockRuntime'
import { describeDroppedScan, describeSignInNeeded, describeWaitingScans } from '@/lib/clock/clockMessages'
import { ClockNoticePanel } from './ClockNoticePanel'

/**
 * What the phone is holding for the server: scans it had to give up on (told
 * once, until "Got it"), a lost login (with a button to sign in again), scans
 * waiting for signal, or "no signal, showing what this phone last knew".
 * Nothing when all is well.
 */
const PhoneState: React.FC<{ view: ClockView }> = ({ view }) => {
  if (view.needsSignIn) return <ClockNoticePanel notice={describeSignInNeeded(view.pendingCount > 0)} />
  if (view.pendingEvent) {
    return (
      <ClockNoticePanel
        notice={describeWaitingScans(view.pendingEvent.kind, view.pendingEvent.scannedAtMs, view.pendingCount)}
      />
    )
  }
  if (view.offline) {
    return (
      <p role="status" className="text-center text-sm text-muted-foreground">
        No signal right now. Showing what this phone last knew about your shift.
      </p>
    )
  }
  return null
}

export const ClockStatusBanner: React.FC<{ view: ClockView }> = ({ view }) => (
  <>
    {view.droppedScans.map((scan) => (
      <ClockNoticePanel
        key={scan.eventId}
        notice={describeDroppedScan(scan)}
        secondary={{ label: 'Got it', onClick: () => dismissDroppedScans(scan.userId, scan.eventId) }}
      />
    ))}
    <PhoneState view={view} />
  </>
)
