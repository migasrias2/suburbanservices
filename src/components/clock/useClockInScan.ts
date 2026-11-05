import { useCallback, useRef, type MutableRefObject } from 'react'
import { QRService } from '@/services/qrService'
import { dismissDroppedScans, queueClockFailureReport, submitClockScan } from '@/lib/clock/clockRuntime'
import {
  clockInIsFinished,
  describeClockOutcome,
  describeUnreadableCode,
  describeWrongPoster,
  type ClockNotice,
} from '@/lib/clock/clockMessages'
import { isServerAnswer } from '@/lib/clock/clockEvents'
import { buildClockDevice } from '@/lib/clock/deviceInfo'
import { requestLocationOnce, type Coordinates } from '@/lib/clock/location'
import type { SendOutcome } from '@/lib/clock/outbox'
import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'

/**
 * A scanned code on the clock-in screen.
 *
 * The phone only checks the kind of poster, using the same parser the server
 * copies (so they agree): a code for another job is explained on the spot and
 * never saved on the phone, because an area code waiting offline would read as
 * "clocked in, waiting to send". A Clock In code goes to the outbox.
 */
export type ClockInScanResult =
  | { status: 'sent'; outcome: SendOutcome }
  | { status: 'failed'; message: string; definitive: boolean }

interface Options {
  userId: string
  userName: string
  diagnosticsRef: MutableRefObject<ScanDiagnostics | null>
}

const asMessage = (notice: ClockNotice) => [notice.title, notice.body].filter(Boolean).join('. ')

export function useClockInScan({ userId, userName, diagnosticsRef }: Options) {
  const locationRef = useRef<Promise<Coordinates | null> | null>(null)
  const lastReportRef = useRef<{ key: string; at: number } | null>(null)

  /** GPS starts with the camera, so it is usually ready by the time a code is read. */
  const startLocation = useCallback(() => {
    locationRef.current = requestLocationOnce()
  }, [])

  const siteFromPayload = useCallback((payload: string): string | undefined => {
    const parsed = QRService.parseQRCode(payload)
    return parsed?.metadata?.siteName || parsed?.customerName || undefined
  }, [])

  // The Clock Out poster on the clock-in screen is worth a (throttled) report:
  // it is the classic "stuck" moment the audit found.
  const reportWrongPoster = (kind: string, qrCodeId: string) => {
    const key = `${kind}:${qrCodeId}`
    const now = Date.now()
    const last = lastReportRef.current
    if (last && last.key === key && now - last.at < 30_000) return
    lastReportRef.current = { key, at: now }
    void queueClockFailureReport({
      eventType: 'clock_in',
      reason: `Scanned on the wrong screen: a ${kind} code on the clock-in screen`,
      cleanerName: userName,
      qrCodeId,
    })
  }

  const handleText = async (text: string): Promise<ClockInScanResult> => {
    const scannedAtMs = Date.now()
    const parsed = QRService.parseQRCode(text)
    const kind = parsed ? QRService.normalizeQrType(parsed.type) : null
    if (!parsed || !kind) return { status: 'failed', message: asMessage(describeUnreadableCode('clock_in')), definitive: true }
    if (kind !== 'CLOCK_IN') {
      if (kind === 'CLOCK_OUT') reportWrongPoster(kind, parsed.id)
      return { status: 'failed', message: asMessage(describeWrongPoster('clock_in', kind)), definitive: true }
    }
    const location = await (locationRef.current ?? requestLocationOnce())
    const outcome = await submitClockScan({
      kind: 'clock_in',
      userId,
      qrPayload: text,
      scannedAtMs,
      location,
      device: { ...buildClockDevice({ diagnostics: diagnosticsRef.current }) },
    })
    if (clockInIsFinished(outcome)) return { status: 'sent', outcome }
    // Explained right here, so not again on the next visit.
    if (outcome.status === 'failed') dismissDroppedScans(userId, outcome.event.eventId)
    // A refusal from the server, or an error that will always repeat, is final
    // for this code; an answer we couldn't read may be worth one more scan.
    const definitive = outcome.status === 'failed' || (outcome.status === 'answered' && isServerAnswer(outcome.result))
    return { status: 'failed', message: asMessage(describeClockOutcome('clock_in', outcome)), definitive }
  }

  return { startLocation, siteFromPayload, handleText }
}
