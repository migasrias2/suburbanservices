import { useCallback, useRef, useState } from 'react'
import { QRService } from '@/services/qrService'
import { clearDraft } from '@/lib/offlineStore'
import { dismissDroppedScans, queueClockFailureReport, submitClockScan } from '@/lib/clock/clockRuntime'
import {
  clockOutIsFinished,
  describeClockOutcome,
  describeUnreadableCode,
  describeWrongPoster,
  type ClockNotice,
} from '@/lib/clock/clockMessages'
import { buildClockDevice } from '@/lib/clock/deviceInfo'
import { requestLocationOnce, type Coordinates } from '@/lib/clock/location'
import type { SendOutcome } from '@/lib/clock/outbox'
import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'
import { holdAppReload } from '@/lib/appReloadGuard'

/**
 * The clock-out, for ClockOutValidator.
 *
 * The scan goes to the outbox and the clock_out RPC; the server writes the
 * shift, cleaner_logs and live_tracking, so nothing here writes them. The
 * screen is told once the attempt is over (saved, kept on the phone, or the
 * shift turned out to be closed already); anything else stays on screen so
 * the cleaner can scan again.
 */
interface Options {
  cleanerId: string
  cleanerName: string
  onFinished?: (outcome: SendOutcome) => void
}

// The shift is over, so the task draft for it is too (as the old clock-out did).
const finishWorkDrafts = (cleanerId: string) => {
  QRService.finalizeRemoteDraft(cleanerId).catch(() => undefined)
  clearDraft().catch(() => undefined)
}

export function useClockOutV2({ cleanerId, cleanerName, onFinished }: Options) {
  const [notice, setNotice] = useState<ClockNotice | null>(null)
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)
  const diagnosticsRef = useRef<ScanDiagnostics | null>(null)
  const locationRef = useRef<Promise<Coordinates | null> | null>(null)
  const lastReportRef = useRef<{ key: string; at: number } | null>(null)

  /** GPS starts with the camera, so it is usually ready by the time a code is read. */
  const startLocation = useCallback(() => {
    locationRef.current = requestLocationOnce()
  }, [])

  const reportWrongPoster = (reason: string, qrCodeId: string | null) => {
    const now = Date.now()
    const last = lastReportRef.current
    if (last && last.key === reason && now - last.at < 30_000) return
    lastReportRef.current = { key: reason, at: now }
    void queueClockFailureReport({ eventType: 'clock_out', reason, cleanerName, qrCodeId })
  }

  const submit = async (rawText: string, scannedAtMs: number) => {
    if (submittingRef.current) return
    submittingRef.current = true
    const releaseReload = holdAppReload()
    let finished = false
    setSaving(true)
    setNotice(null)
    try {
      const location = await (locationRef.current ?? requestLocationOnce())
      const outcome = await submitClockScan({
        kind: 'clock_out',
        userId: cleanerId || localStorage.getItem('userId') || '',
        qrPayload: rawText,
        scannedAtMs,
        location,
        device: { ...buildClockDevice({ diagnostics: diagnosticsRef.current }) },
      })
      finished = clockOutIsFinished(outcome)
      if (finished) {
        finishWorkDrafts(cleanerId)
        onFinished?.(outcome)
      } else {
        // Explained right here, so not again on the next visit.
        if (outcome.status === 'failed') dismissDroppedScans(outcome.event.userId, outcome.event.eventId)
        setNotice(describeClockOutcome('clock_out', outcome))
      }
    } catch (error) {
      console.error('Clock-out failed', error)
      setNotice(describeUnreadableCode('clock_out'))
    } finally {
      // Stay locked after the attempt is over: a straggling decode must not send again.
      if (!finished) submittingRef.current = false
      setSaving(false)
      releaseReload()
    }
  }

  /** A decoded code on the clock-out screen. Only a Clock Out code is sent. */
  const handleText = async (text: string, stopCamera: () => void) => {
    if (submittingRef.current) return
    const scannedAtMs = Date.now()
    const parsed = QRService.parseQRCode(text)
    const kind = parsed ? QRService.normalizeQrType(parsed.type) : null
    if (!parsed || !kind) {
      setNotice(describeUnreadableCode('clock_out'))
      return
    }
    if (kind !== 'CLOCK_OUT') {
      setNotice(describeWrongPoster('clock_out', kind))
      reportWrongPoster(`Scanned a ${kind} code instead of a clock-out code`, parsed.id)
      return
    }
    stopCamera()
    await submit(text, scannedAtMs)
  }

  return { notice, setNotice, saving, diagnosticsRef, startLocation, submit, handleText }
}
