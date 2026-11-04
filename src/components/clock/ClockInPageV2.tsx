import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Loader2, QrCode } from 'lucide-react'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { QRScanner, type DecodeTextOutcome } from '@/components/qr/QRScanner'
import { WorkflowManager } from '@/components/qr/WorkflowManager'
import { OpsWorkflowManager } from '@/components/qr/OpsWorkflowManager'
import { ClockOutValidator } from '@/components/qr/ClockOutValidator'
import { ShiftSummaryCard } from '@/components/qr/ShiftSummaryCard'
import { Button } from '@/components/ui/button'
import { useCurrentShift } from '@/hooks/useCurrentShift'
import { getStoredCleanerName } from '@/lib/identity'
import { useClockSwitches } from '@/lib/clock/clockFlags'
import {
  describeAutoClosedShift,
  describeClockOutcome,
  type ClockNotice,
} from '@/lib/clock/clockMessages'
import type { CurrentShiftView } from '@/lib/clock/currentShift'
import type { ClockView } from '@/lib/clock/clockRuntime'
import type { SendOutcome } from '@/lib/clock/outbox'
import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'
import { ClockNoticePanel } from './ClockNoticePanel'
import { ClockStatusBanner } from './ClockStatusBanner'
import { useClockInScan } from './useClockInScan'

/**
 * The clock-in page on the new clock path (clock_v2).
 *
 * Which screen shows comes from one place, the current-shift source (the
 * server's open shift, plus scans waiting on the phone), not from the
 * cleaner's name and not from the phone's calendar day. Every clock event goes
 * through the outbox to the clock_in / clock_out RPCs, which write the shift,
 * cleaner_logs and live_tracking rows themselves.
 */
type UserType = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

const siteFor = (view: CurrentShiftView, parseSite: (payload: string) => string | undefined) =>
  view.openShift?.siteName ||
  view.openShift?.customerName ||
  (view.pendingEvent ? parseSite(view.pendingEvent.qrPayload) : undefined)

const summaryShiftId = (outcome: SendOutcome): number | null =>
  outcome.status === 'answered' && 'shift' in outcome.result ? (outcome.result.shift?.id ?? null) : null

const askForNotifications = () => {
  // Asked at clock-in, the moment the clock-out reminder starts to matter.
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => undefined)
  }
}

const isAutoClosed = (view: CurrentShiftView) =>
  view.status === 'off_shift' && !view.pendingEvent && Boolean(view.lastClosed?.autoClosed && view.lastClosed?.clockOutMissing)

export default function ClockInPageV2() {
  const userName = getStoredCleanerName() || 'Cleaner'
  const userType = (localStorage.getItem('userType') as UserType) || 'cleaner'
  const userId = localStorage.getItem('userId') || ''
  const navigate = useNavigate()
  const { scannerV2 } = useClockSwitches()
  const { view, ready } = useCurrentShift(userId)
  const [showScanner, setShowScanner] = useState(false)
  const [notice, setNotice] = useState<ClockNotice | null>(null)
  const [finished, setFinished] = useState<SendOutcome | null>(null)
  // The clock-out scanner on its own: "Record my finish time" after an
  // auto-close, or "Clock out" from a notice (still clocked in at another site).
  const [clockingOut, setClockingOut] = useState(false)
  const diagnosticsRef = useRef<ScanDiagnostics | null>(null)
  const clockInScan = useClockInScan({ userId, userName, scannerV2, diagnosticsRef })

  const startClockIn = () => {
    setNotice(null)
    clockInScan.startLocation()
    setShowScanner(true)
  }

  const handleClockInText = async (text: string): Promise<DecodeTextOutcome> => {
    const result = await clockInScan.handleText(text)
    if (result.status === 'failed') return result
    // A waiting or sign-in scan is shown by the status banner, so only server answers get a notice.
    if (result.outcome.status === 'answered') setNotice(describeClockOutcome('clock_in', result.outcome))
    if (result.outcome.status === 'answered' && result.outcome.result.code === 'clocked_in') askForNotifications()
    setShowScanner(false)
    return { status: 'done' }
  }

  const handleClockOutDone = (outcome?: SendOutcome) => {
    if (!outcome) return
    setClockingOut(false)
    setNotice(outcome.status === 'answered' ? describeClockOutcome('clock_out', outcome) : null)
    const noShift = outcome.status === 'answered' && !outcome.result.ok && outcome.result.code === 'no_open_shift'
    if (!noShift) setFinished(outcome)
  }

  const handleDone = () => {
    setFinished(null)
    setNotice(null)
    // /cleaner-dashboard is cleaners-only; ops managers go to their own home.
    navigate(userType === 'ops_manager' ? '/ops-dashboard' : '/cleaner-dashboard')
  }

  const noticePanel = notice ? (
    <ClockNoticePanel
      notice={notice}
      onScanClockIn={startClockIn}
      onClockOut={() => {
        setNotice(null)
        setClockingOut(true)
      }}
      onDismiss={() => setNotice(null)}
    />
  ) : null

  const renderBody = () => {
    if (finished) {
      const shiftId = summaryShiftId(finished)
      return (
        <div className="mx-auto w-full max-w-md space-y-4">
          <ClockStatusBanner view={view} />
          {noticePanel}
          {shiftId != null ? (
            <ShiftSummaryCard cleanerId={userId} cleanerName={userName} shiftId={shiftId} onDone={handleDone} />
          ) : (
            <Button onClick={handleDone} className="h-12 w-full rounded-full">
              Done
            </Button>
          )}
        </div>
      )
    }

    if (clockingOut) {
      return (
        <ClockOutValidator
          cleanerId={userId}
          cleanerName={userName}
          onClockOutSuccess={handleClockOutDone}
          onCancel={() => setClockingOut(false)}
        />
      )
    }

    if (!ready) {
      return (
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking your shift…
        </div>
      )
    }

    if (view.status === 'on_shift') {
      const clockInTime = view.clockInAt ?? undefined
      const siteName = siteFor(view, clockInScan.siteFromPayload)
      return (
        <div className="space-y-4">
          <div className="mx-auto w-full max-w-lg space-y-3 px-4 sm:px-0">
            <ClockStatusBanner view={view} />
            {noticePanel}
          </div>
          {userType === 'ops_manager' ? (
            <OpsWorkflowManager
              cleanerId={userId}
              cleanerName={userName}
              clockInTime={clockInTime}
              siteName={siteName}
              customerName={view.openShift?.customerName}
              onClockOut={handleClockOutDone}
              showWelcomeClockOut
            />
          ) : (
            <WorkflowManager
              cleanerId={userId}
              cleanerName={userName}
              clockInTime={clockInTime}
              siteName={siteName}
              onClockOut={handleClockOutDone}
            />
          )}
        </div>
      )
    }

    return (
      <ClockInScreen
        view={view}
        noticePanel={noticePanel}
        showScanner={showScanner}
        onStart={startClockIn}
        onCancel={() => setShowScanner(false)}
        onRecordFinish={() => setClockingOut(true)}
        scanner={
          <QRScanner
            cleanerId={userId}
            cleanerName={userName}
            onDecodeText={handleClockInText}
            onDiagnostics={(d) => {
              diagnosticsRef.current = d
            }}
          />
        }
      />
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="max-w-4xl mx-auto py-8">{renderBody()}</div>
    </Sidebar07Layout>
  )
}

interface ClockInScreenProps {
  view: ClockView
  noticePanel: React.ReactNode
  showScanner: boolean
  onStart: () => void
  onCancel: () => void
  onRecordFinish: () => void
  scanner: React.ReactNode
}

const ClockInScreen: React.FC<ClockInScreenProps> = ({
  view,
  noticePanel,
  showScanner,
  onStart,
  onCancel,
  onRecordFinish,
  scanner,
}) => (
  <div className="flex flex-col items-center text-center gap-8">
    <div className="space-y-4">
      <div className="w-20 h-20 mx-auto bg-primary rounded-full flex items-center justify-center shadow-lg">
        <Clock className="w-10 h-10 text-primary-foreground" />
      </div>
      <h1 className="text-4xl font-bold text-primary">Clock In</h1>
      <p className="text-lg text-muted-foreground max-w-md">
        To begin your shift, scan the Clock In QR code at your work location
      </p>
    </div>

    <div className="w-full max-w-md space-y-3">
      <ClockStatusBanner view={view} />
      {noticePanel}
      {isAutoClosed(view) && (
        <ClockNoticePanel
          notice={describeAutoClosedShift(view.lastClosed?.clockOut ?? null)}
          secondary={{ label: 'Record my finish time', onClick: onRecordFinish }}
        />
      )}
    </div>

    {!showScanner ? (
      <div className="space-y-6">
        <div className="p-6 bg-primary/10 rounded-3xl max-w-md mx-auto">
          <div className="flex items-center justify-center gap-3 text-primary">
            <QrCode className="w-6 h-6" />
            <span className="text-lg font-medium">Ready to scan</span>
          </div>
        </div>
        <Button
          onClick={onStart}
          className="rounded-full px-12 py-6 text-lg font-semibold text-primary-foreground shadow-lg transition-all duration-200 bg-primary"
        >
          <QrCode className="w-6 h-6 mr-3" />
          Start Clock In
        </Button>
      </div>
    ) : (
      <div className="w-full max-w-md">
        {scanner}
        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={onCancel} className="text-muted-foreground rounded-full">
            Cancel Scanning
          </Button>
        </div>
      </div>
    )}
  </div>
)
