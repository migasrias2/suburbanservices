import React, { useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, X } from 'lucide-react'
import { QRService, QRCodeData, type ScanResult } from '../../services/qrService'
import { describeWrongQrType, isClockCode } from '../../lib/wrongQrType'
import { isOnShiftForAreaScan, queueClockFailureReport } from '@/lib/clock/clockRuntime'
import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'
import { QrCamera } from '@/components/qr/scanner/QrCamera'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { ClockInRequiredCard, SavingOverlay } from './QRScannerParts'

/**
 * What a parent that handles the scanned text itself (onDecodeText) reports
 * back: 'done' stops the camera; 'failed' shows the message, and a definitive
 * one blocks that code until ✕, exactly like the scanner's own failures.
 */
export type DecodeTextOutcome = { status: 'done' } | { status: 'failed'; message: string; definitive: boolean }

interface QRScannerProps {
  cleanerId: string
  cleanerName: string
  onScanSuccess?: (data: QRCodeData) => void
  onScanError?: (error: string) => void
  // Restrict which QR types are valid for this scanner instance
  allowedTypes?: QRCodeData['type'][]
  // When true, bypass logging and return the raw QR payload for admin testing
  previewMode?: boolean
  // Offer a real code of a disallowed type to the parent; return true if it took it
  onWrongType?: (data: QRCodeData) => boolean
  // The parent takes the raw text after the scanner's own guards (dedupe, one
  // at a time, Saving…), instead of processQRScan. The clock-in screen does.
  onDecodeText?: (text: string) => Promise<DecodeTextOutcome>
  // Facts about the camera session, for the clock event's device field.
  onDiagnostics?: (diagnostics: ScanDiagnostics) => void
}

// The same code is ignored for this long after a read, so one poster held in
// view is not processed twice. It used to be 10 s, which made a retry after an
// error look like a dead scanner.
const SCAN_DEDUPE_MS = 3000

export const QRScanner: React.FC<QRScannerProps> = ({
  cleanerId,
  cleanerName,
  onScanSuccess,
  onScanError,
  allowedTypes,
  previewMode = false,
  onWrongType,
  onDecodeText,
  onDiagnostics,
}) => {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Task selector is handled by parent workflow; do not embed here
  const [isProcessing, setIsProcessing] = useState(false)
  // <QrCamera/> is paused while saving; this ref is the belt-and-braces guard
  // (a decode in flight can still land before React re-renders).
  const processingRef = useRef(false)
  // A code whose save failed. Not retried until the error is dismissed or a
  // different code is read, so a poster left in view doesn't loop.
  const failedCodeRef = useRef<string | null>(null)
  const lastScanCodeRef = useRef<{ code: string; time: number } | null>(null)
  // One failure record per code per 30s; the camera decodes several times a second.
  const wrongTypeReportRef = useRef<{ key: string; at: number } | null>(null)
  const [wrongType, setWrongType] = useState<QRCodeData['type'] | null>(null)
  const handledSuccessRef = useRef(false)
  const navigate = useNavigate()
  const [clockInRequired, setClockInRequired] = useState(false)

  // Turning <QrCamera/> off releases the camera at once.
  const stopScanning = useCallback(() => {
    setIsScanning(false)
  }, [])

  const finalizeSuccess = useCallback((qrData: QRCodeData) => {
    if (handledSuccessRef.current) return
    handledSuccessRef.current = true
    stopScanning()
    onScanSuccess?.(qrData)
  }, [stopScanning, onScanSuccess])

  // A definitive answer from the rules ("already clocked in") stays, and that
  // code is blocked until ✕ or another code: scanning again would only repeat
  // it. Anything else (no signal, a save that didn't land) is retried by
  // pointing at the poster again, 3 s after the error.
  const showScanFailure = (code: string, outcome: ScanResult) => {
    const message = outcome.message || 'Failed to process QR code scan'
    onScanError?.(message)
    if (outcome.definitive) {
      failedCodeRef.current = code
      setError(`${message} Tap ✕ to scan again.`)
      return
    }
    lastScanCodeRef.current = { code, time: Date.now() }
    setError(message)
  }

  const dismissError = () => {
    setError(null)
    failedCodeRef.current = null
    lastScanCodeRef.current = null
  }

  const handleDecode = async (text: string) => {
    // These checks sit outside the try below on purpose: a decode can land
    // while another is still being handled, and only the call that takes the
    // processing guard may release it in `finally`.
    if (handledSuccessRef.current) return

    let qrData = QRService.parseQRCode(text)
    if (!qrData) {
      setError('Invalid QR code format. QR code should contain "Clock In" text or be in JSON format.')
      return
    }
    if (failedCodeRef.current === text) return

    // Deduplicate: ignore the same QR code read again within the window
    const now = Date.now()
    const last = lastScanCodeRef.current
    if (last && last.code === text && now - last.time < SCAN_DEDUPE_MS) return
    // Synchronous guard via ref to prevent duplicate processing
    // (useState is async and captured in closures — useless for this)
    if (processingRef.current) return

    lastScanCodeRef.current = { code: text, time: now }
    failedCodeRef.current = null
    processingRef.current = true
    // Shown as "Saving…" over the camera, so a read that takes a few seconds
    // on bad signal doesn't look like a scan that failed. A new attempt
    // replaces the last error.
    setIsProcessing(true)
    setError(null)

    try {
      if (onDecodeText) {
        const outcome = await onDecodeText(text)
        if (outcome.status === 'done') finalizeSuccess(qrData)
        else showScanFailure(text, { success: false, message: outcome.message, definitive: outcome.definitive })
        return
      }

      const scannedType = QRService.normalizeQrType(qrData.type)
      const rawPayload = text.trim()

      // A clock code for another screen goes to the parent straight away, with
      // its raw text and decode time, before any lookup. The server parses the
      // text itself; waiting on lookups on weak signal left the clock-out in
      // nobody's outbox (review M5).
      const handOver =
        onWrongType && allowedTypes && isClockCode(scannedType) && !allowedTypes.includes(scannedType as QRCodeData['type'])
      if (handOver && onWrongType({ ...qrData, type: scannedType as QRCodeData['type'], rawPayload: text, scannedAtMs: now })) {
        stopScanning()
        return
      }

      // Resolve canonical data from database before type-gating.
      // Some legacy QR payloads are stale/mis-typed while DB metadata is correct.
      try {
        const supabaseClient = (await import('../../services/supabase')).supabase
        const canonicalSelect = 'qr_code_url, area_description, is_active'

        const { data: byIdRow } = await supabaseClient
          .from('building_qr_codes')
          .select(canonicalSelect)
          .eq('qr_code_id', qrData.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()

        let canonicalRow = byIdRow
        if (!canonicalRow && rawPayload) {
          const { data: byPayloadRow } = await supabaseClient
            .from('building_qr_codes')
            .select(canonicalSelect)
            .eq('qr_code_url', rawPayload)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()
          canonicalRow = byPayloadRow
        }

        if (canonicalRow?.qr_code_url) {
          const resolved = QRService.parseQRCode(canonicalRow.qr_code_url)
          if (resolved) {
            const resolvedType = QRService.normalizeQrType(resolved.type)

            // Keep scanned action type by default, but if this scanner has strict allowed
            // types and DB canonical type matches one of them, trust canonical type.
            if (scannedType && resolvedType && scannedType !== resolvedType) {
              const preferredType =
                allowedTypes && allowedTypes.includes(resolvedType) ? resolvedType : scannedType
              qrData = { ...resolved, type: preferredType }
            } else {
              qrData = resolved
            }
          } else {
            const rowType = QRService.normalizeQrType(canonicalRow.area_description)
            if (rowType) {
              qrData = { ...qrData, type: rowType }
            }
          }
        }
      } catch {}

      // Enforce type restrictions after canonical resolution.
      if (allowedTypes && !allowedTypes.includes(qrData.type)) {
        // Let this code be retried after ~1.5s instead of swallowing it
        // for the whole window, without re-running on every frame.
        lastScanCodeRef.current = { code: text, time: now - SCAN_DEDUPE_MS + 1500 }
        processingRef.current = false
        setIsProcessing(false)
        // The clock sends the poster's own text to the server, so hand it over.
        if (onWrongType?.({ ...qrData, rawPayload: text, scannedAtMs: now })) {
          stopScanning()
          return
        }
        setWrongType(qrData.type)
        setTimeout(() => setWrongType(null), 4000)
        const lastReport = wrongTypeReportRef.current
        const reportKey = `${qrData.type}:${qrData.id}`
        const recentlyReported =
          lastReport && lastReport.key === reportKey && now - lastReport.at < 30_000
        if (!previewMode && isClockCode(qrData.type) && !recentlyReported) {
          wrongTypeReportRef.current = { key: reportKey, at: now }
          // Kept on the phone while signed out, sent after sign-in (D7c).
          void queueClockFailureReport({
            eventType: qrData.type === 'CLOCK_IN' ? 'clock_in' : 'clock_out',
            reason: `Scanned on the wrong screen: ${describeWrongQrType(qrData.type, allowedTypes)}`,
            cleanerName,
            qrCodeId: qrData.id,
            customerName: qrData.customerName ?? null,
          })
        }
        return
      }

      // Get user location if available
      let location: { latitude: number; longitude: number } | undefined

      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              enableHighAccuracy: true
            })
          })
          location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }
        } catch (geoError) {
          console.warn('Could not get location:', geoError)
        }
      }

      // Cleaners must have an open clock-in before scanning area/task QRs.
      // Why: prevents on-site work being invisible to the live dashboard (real incident, May 2026).
      // How to apply: skip for managers/admin and for non-area scans; check fails open on network errors.
      // It asks the server for the open shift (any day, so a night shift still
      // counts after midnight). Non-cleaners skip the check on purpose: only
      // cleaners reach area scanning here (ops managers use OpsWorkflowManager,
      // managers/admins only the previewMode test scan).
      const userType = typeof window !== 'undefined' ? localStorage.getItem('userType') : null
      const requiresClockIn =
        !previewMode &&
        userType === 'cleaner' &&
        (qrData.type === 'AREA' || qrData.type === 'TASK')
      if (requiresClockIn) {
        const hasOpen = await isOnShiftForAreaScan(cleanerId)
        if (!hasOpen) {
          setClockInRequired(true)
          processingRef.current = false
          setIsProcessing(false)
          stopScanning()
          return
        }
      }

      // Check if this QR code should show task selector
      // Only AREA QR codes show tasks, CLOCK_IN just processes the clock in
      const shouldGoToTasks = qrData.type === 'AREA'

      if (shouldGoToTasks) {
        if (!previewMode) {
          const outcome = await QRService.processQRScan(qrData, cleanerId, cleanerName, location)
          if (!outcome.success) {
            // Stays on screen until dismissed or replaced by the next attempt.
            showScanFailure(text, outcome)
            return
          }
        }

        // Delegate to parent to render tasks UI; avoid duplicate headers/buttons
        finalizeSuccess(qrData)
        return
      }

      if (previewMode) {
        finalizeSuccess(qrData)
      } else {
        // TASK/FEEDBACK. A clock code is refused there: clocking happens on the
        // Clock In screen (onDecodeText), through the server.
        const outcome = await QRService.processQRScan(qrData, cleanerId, cleanerName, location)

        if (outcome.success) {
          finalizeSuccess(qrData)
        } else {
          // Stays on screen until dismissed or replaced by the next attempt.
          // It used to vanish after 2 s, while the cleaner was looking at the poster.
          showScanFailure(text, outcome)
        }
      }

    } catch (err) {
      console.error('Error processing QR scan:', err)
      showScanFailure(text, { success: false, message: 'Error processing QR code' })
    } finally {
      processingRef.current = false
      setIsProcessing(false)
    }
  }

  // <QrCamera/> owns the camera, so Start only turns it on. A new Start is an
  // explicit retry: forget any code blocked by an error.
  const startScanning = () => {
    setError(null)
    failedCodeRef.current = null
    lastScanCodeRef.current = null
    handledSuccessRef.current = false
    setIsScanning(true)
  }

  // Task UI is handled by parent; this component just scans

  if (clockInRequired) {
    return <ClockInRequiredCard onGoToClockIn={() => navigate('/clock-in')} onCancel={() => setClockInRequired(false)} />
  }

  const wrongTypeBadge = wrongType ? (
    <div className="absolute top-3 left-1/2 -translate-x-1/2">
      <div className="px-3 py-1 rounded-full bg-warning/10 text-warning text-xs font-medium border border-warning/30 shadow-sm">
        {describeWrongQrType(wrongType, allowedTypes ?? [])}
      </div>
    </div>
  ) : null

  return (
    <div className="w-full space-y-4">
      <div className="space-y-4">
        {/* Camera View */}
        <QrCamera
          active={isScanning}
          paused={isProcessing}
          onDecode={(text) => void handleDecode(text)}
          onDiagnostics={onDiagnostics}
          overlay={
            <>
              {wrongTypeBadge}
              {isProcessing && <SavingOverlay />}
            </>
          }
        />

        {/* Controls */}
        {!isScanning ? (
          <Button 
            onClick={startScanning} 
            className="w-full rounded-full py-6 text-lg font-semibold text-primary-foreground shadow-lg transition-all duration-200 bg-primary"
          >
            <Camera className="h-5 w-5 mr-3" />
            Start scanning
          </Button>
        ) : (
          <Button 
            onClick={stopScanning} 
            variant="destructive" 
            className="w-full rounded-full py-6 text-lg font-semibold"
          >
            Stop Scanning
          </Button>
        )}

        {error && (
          <Alert variant="destructive" className="rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <AlertDescription>{error}</AlertDescription>
              <button
                type="button"
                onClick={dismissError}
                aria-label="Dismiss message"
                className="-m-1 shrink-0 rounded-full p-1 hover:bg-destructive/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </Alert>
        )}
      </div>
    </div>
  )
}
