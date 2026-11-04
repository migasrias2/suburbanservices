import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, QrCode, AlertCircle, CheckCircle2, Clock, SwitchCamera, Loader2, X } from 'lucide-react'
import QrScanner from 'qr-scanner'
import {
  activeCameraId,
  nextCameraId,
  framesAreFlowing,
  pickScanCamera,
  readRememberedCamera,
  releaseScanner,
  rememberCamera,
  REOPEN_GAP_MS,
  sleep,
  type CameraOption,
} from '@/lib/cameraChoice'
import { QRService, QRCodeData, type ScanResult } from '../../services/qrService'
import { ClockOutValidator } from './ClockOutValidator'
import { hasOpenClockInToday } from '../../services/attendanceService'
import { reportClockFailure } from '../../services/clockFailureService'
import { describeWrongQrType, isClockCode } from '../../lib/wrongQrType'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'

interface QRScannerProps {
  cleanerId: string
  cleanerName: string
  onScanSuccess?: (data: QRCodeData) => void
  onScanError?: (error: string) => void
  // Restrict which QR types are valid for this scanner instance
  allowedTypes?: QRCodeData['type'][]
  // Show clock-out option with validator when scanning (useful on area step)
  showClockOutOption?: boolean
  onClockOutSuccess?: () => void
  // When true, bypass logging and return the raw QR payload for admin testing
  previewMode?: boolean
  // Offer a real code of a disallowed type to the parent; return true if it took it
  onWrongType?: (data: QRCodeData) => boolean
}

// The same code is ignored for this long after a read, so one poster held in
// view is not processed twice. It used to be 10 s, which made a retry after an
// error look like a dead scanner.
const SCAN_DEDUPE_MS = 3000

// listCameras(false) only enumerates; it never opens a throwaway stream.
const listCamerasQuietly = (): Promise<CameraOption[]> =>
  QrScanner.listCameras(false).catch(() => [] as CameraOption[])

export const QRScanner: React.FC<QRScannerProps> = ({
  cleanerId,
  cleanerName,
  onScanSuccess,
  onScanError,
  allowedTypes,
  showClockOutOption,
  onClockOutSuccess,
  previewMode = false,
  onWrongType
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [qrScanner, setQrScanner] = useState<QrScanner | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [lastScan, setLastScan] = useState<{
    data: QRCodeData
    timestamp: Date
    success: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown')
  // Task selector is handled by parent workflow; do not embed here
  const [isProcessing, setIsProcessing] = useState(false)
  const processingRef = useRef(false)
  // A ref, not isScanning: a double tap lands before React re-renders, and two
  // scanners on one video fight over it and orphan a stream.
  const startingRef = useRef(false)
  // Bumped by Stop and by leaving the screen. A start that sees it change
  // after an await was cancelled, and must release what it opened.
  const startGenRef = useRef(0)
  // When the last scanner was released; see REOPEN_GAP_MS.
  const lastReleaseAtRef = useRef(0)
  const switchingRef = useRef(false)
  // A code whose save failed. Not retried until the error is dismissed or a
  // different code is read, so a poster left in view doesn't loop.
  const failedCodeRef = useRef<string | null>(null)
  const lastScanCodeRef = useRef<{ code: string; time: number } | null>(null)
  // One failure record per code per 30s; the camera decodes several times a second.
  const wrongTypeReportRef = useRef<{ key: string; at: number } | null>(null)
  const [wrongType, setWrongType] = useState<QRCodeData['type'] | null>(null)
  const [showClockOut, setShowClockOut] = useState(false)
  const [hasHandledSuccess, setHasHandledSuccess] = useState(false)
  const handledSuccessRef = useRef(false)
  const navigate = useNavigate()
  const [clockInRequired, setClockInRequired] = useState(false)
  const [cameras, setCameras] = useState<CameraOption[]>([])
  const [cameraId, setCameraId] = useState<string | null>(null)

  // The decode callback is bound once, when the scanner is created, so it only ever saw
  // the qrScanner state from before the scanner existed (null): stopping from
  // inside it did nothing and the camera kept firing. The ref is always current.
  const scannerRef = useRef<QrScanner | null>(null)

  const stopScanning = useCallback(() => {
    startGenRef.current += 1
    startingRef.current = false
    const scanner = scannerRef.current ?? qrScanner
    if (scanner) {
      // Released now, not on qr-scanner's 300 ms stop() timer, so the camera
      // light goes off at once.
      lastReleaseAtRef.current = performance.now()
      void releaseScanner(scanner)
      scannerRef.current = null
      setQrScanner(null)
    }
    setIsScanning(false)
  }, [qrScanner])

  const finalizeSuccess = useCallback((qrData: QRCodeData) => {
    if (handledSuccessRef.current) return
    handledSuccessRef.current = true
    setHasHandledSuccess(true)
    setLastScan({
      data: qrData,
      timestamp: new Date(),
      success: true,
    })
    stopScanning()
    onScanSuccess?.(qrData)
  }, [hasHandledSuccess, stopScanning, onScanSuccess])

  useEffect(() => {
    return () => {
      if (qrScanner) void releaseScanner(qrScanner)
    }
  }, [qrScanner])

  // Leaving the screen cancels a start that is still under way.
  useEffect(() => {
    const generation = startGenRef
    return () => {
      generation.current += 1
    }
  }, [])

  useEffect(() => {
    const checkPermission = async () => {
      if (!navigator.permissions?.query) {
        setPermissionState('prompt')
        return
      }
      try {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName })
        setPermissionState(result.state === 'prompt' ? 'prompt' : (result.state as 'granted' | 'denied'))
        result.onchange = () => {
          setPermissionState(result.state === 'prompt' ? 'prompt' : (result.state as 'granted' | 'denied'))
        }
      } catch (err) {
        console.error('Permission api error:', err)
      }
    }
    checkPermission()
  }, [])

  // A definitive answer from the rules ("already clocked in") stays, and that
  // code is blocked until ✕ or another code: scanning again would only repeat
  // it. Anything else (no signal, a save that didn't land) is retried by
  // pointing at the poster again, 3 s after the error; processQRScan keeps the
  // failure log to one row per code and reason per 30 s.
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

  const handleDecode = async (result: QrScanner.ScanResult) => {
    // These checks sit outside the try below on purpose: qr-scanner calls this
    // for every decoded frame without waiting, and only the call that takes
    // the processing guard may release it in `finally`.
    if (handledSuccessRef.current) return

    let qrData = QRService.parseQRCode(result.data)
    if (!qrData) {
      setError('Invalid QR code format. QR code should contain "Clock In" text or be in JSON format.')
      return
    }
    if (failedCodeRef.current === result.data) return

    // Deduplicate: ignore the same QR code read again within the window
    const now = Date.now()
    const last = lastScanCodeRef.current
    if (last && last.code === result.data && now - last.time < SCAN_DEDUPE_MS) return
    // Synchronous guard via ref to prevent duplicate processing
    // (useState is async and captured in closures — useless for this)
    if (processingRef.current) return

    lastScanCodeRef.current = { code: result.data, time: now }
    failedCodeRef.current = null
    processingRef.current = true
    // Shown as "Saving…" over the camera, so a read that takes a few seconds
    // on bad signal doesn't look like a scan that failed. A new attempt
    // replaces the last error.
    setIsProcessing(true)
    setError(null)

    try {
      const scannedType = QRService.normalizeQrType(qrData.type)
      const rawPayload = result.data?.trim() || ''

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
        lastScanCodeRef.current = { code: result.data, time: now - SCAN_DEDUPE_MS + 1500 }
        processingRef.current = false
        setIsProcessing(false)
        if (onWrongType?.(qrData)) {
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
          void reportClockFailure({
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

      // Cleaners must have an open clock-in for today before scanning area/task QRs.
      // Why: prevents on-site work being invisible to the live dashboard (real incident, May 2026).
      // How to apply: skip for managers/admin and for non-area scans; check fails open on network errors.
      const userType = typeof window !== 'undefined' ? localStorage.getItem('userType') : null
      const requiresClockIn =
        !previewMode &&
        userType === 'cleaner' &&
        (qrData.type === 'AREA' || qrData.type === 'TASK')
      if (requiresClockIn) {
        const hasOpen = await hasOpenClockInToday(cleanerId)
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
            showScanFailure(result.data, outcome)
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
        // Process in the background for CLOCK_IN/CLOCK_OUT/FEEDBACK
        const outcome = await QRService.processQRScan(qrData, cleanerId, cleanerName, location)
        
        setLastScan({
          data: qrData,
          timestamp: new Date(),
          success: outcome.success
        })

        if (outcome.success) {
          finalizeSuccess(qrData)
        } else {
          // Stays on screen until dismissed or replaced by the next attempt.
          // It used to vanish after 2 s, while the cleaner was looking at the poster.
          showScanFailure(result.data, outcome)
        }
      }

    } catch (err) {
      console.error('Error processing QR scan:', err)
      showScanFailure(result.data, { success: false, message: 'Error processing QR code' })
    } finally {
      processingRef.current = false
      setIsProcessing(false)
    }
  }

  const releaseNow = (scanner: QrScanner) => {
    lastReleaseAtRef.current = performance.now()
    void releaseScanner(scanner)
    if (scannerRef.current === scanner) {
      scannerRef.current = null
      setQrScanner(null)
    }
  }

  // Wait out the old scanner's release timer before anything opens on this video.
  const waitForReleaseGap = async () => {
    const wait = lastReleaseAtRef.current + REOPEN_GAP_MS - performance.now()
    if (wait > 0) await sleep(wait)
  }

  // Registered before start() so Stop and leaving the screen can always release
  // the camera, even if start() stalls. Null when the start was cancelled.
  const openScanner = async (preferred: string, isCurrent: () => boolean): Promise<QrScanner | null> => {
    const video = videoRef.current
    if (!video || !isCurrent()) return null
    const scanner = new QrScanner(video, handleDecode, {
      returnDetailedScanResult: true,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      preferredCamera: preferred,
    })
    scannerRef.current = scanner
    setQrScanner(scanner)
    try {
      await scanner.start()
    } catch (err) {
      releaseNow(scanner)
      if (!isCurrent()) return null
      throw err
    }
    if (!isCurrent()) {
      releaseNow(scanner)
      return null
    }
    return scanner
  }

  // A camera can open without error and still deliver no frames (a black box).
  // It gets one clean second chance: release it fully, give the phone time to
  // let go, then reopen once on the browser's back camera. The remembered lens
  // is kept; one stall is not proof that it is the wrong lens.
  // 'stopped' means Stop, a successful scan or leaving the screen got there first.
  const ensureFrames = async (
    scanner: QrScanner,
    isCurrent: () => boolean,
  ): Promise<'ok' | 'black' | 'stopped'> => {
    if (await framesAreFlowing(videoRef.current)) return 'ok'
    if (scannerRef.current !== scanner || !isCurrent()) return 'stopped'

    releaseNow(scanner)
    await waitForReleaseGap()
    if (!isCurrent() || scannerRef.current || !videoRef.current) return 'stopped'

    const retry = await openScanner('environment', isCurrent)
    if (!retry) return 'stopped'
    if (await framesAreFlowing(videoRef.current)) return 'ok'
    return scannerRef.current === retry && isCurrent() ? 'black' : 'stopped'
  }

  const startScanning = async () => {
    if (startingRef.current || scannerRef.current || !videoRef.current) return
    startingRef.current = true
    startGenRef.current += 1
    const generation = startGenRef.current
    const isCurrent = () => startGenRef.current === generation
    let opened: QrScanner | null = null

    try {
      setError(null)
      // A new Start is an explicit retry: forget any code blocked by an error.
      failedCodeRef.current = null
      lastScanCodeRef.current = null
      setLastScan(null)
      setIsScanning(true)
      // Hidden until this start's frame check is done: switching during start()
      // makes qr-scanner open a second stream and orphan the first.
      setCameras([])
      handledSuccessRef.current = false
      setHasHandledSuccess(false)

      // No permission probe and no listCameras(true): each opens a throwaway
      // stream, and rapid open/close is what leaves some Android cameras black.
      // Labels are only readable here if camera permission was granted on an
      // earlier visit; on the very first visit the browser picks the camera.
      const chosenCamera = pickScanCamera(await listCamerasQuietly(), readRememberedCamera())
      if (!isCurrent()) return
      setCameraId(chosenCamera)

      await waitForReleaseGap()
      const scanner = await openScanner(chosenCamera ?? 'environment', isCurrent)
      if (!scanner) return
      opened = scanner
      // From here scannerRef guards against a second start.
      startingRef.current = false

      const picture = await ensureFrames(scanner, isCurrent)
      if (picture === 'stopped') return

      // The camera is open, so the labels are readable now. These are the
      // cameras the switch button cycles through.
      const openCameras = await listCamerasQuietly()
      if (!isCurrent()) return
      setCameras(openCameras)
      // When the browser chose, "switch" has to start from what it chose.
      setCameraId(activeCameraId(videoRef.current) ?? chosenCamera)
      if (picture === 'black') {
        setError(
          'The camera opened but is not showing a picture. Close other apps that use the camera, then stop and start scanning again.',
        )
      }
    } catch (err) {
      // Release what this start opened, so Start works again. Once cancelled,
      // scannerRef may belong to a newer start: then only our own scanner.
      const mine = isCurrent() ? scannerRef.current : opened
      if (mine) releaseNow(mine)
      if (!isCurrent()) return
      console.error('Error starting QR scanner:', err)
      setError('Failed to start camera. Please check your camera permissions.')
      setIsScanning(false)
    } finally {
      if (isCurrent()) startingRef.current = false
    }
  }

  // Way out for any phone whose first-choice lens still can't read the code:
  // cycle through the cameras, and remember the one picked if it shows a picture.
  const switchCamera = async () => {
    const scanner = scannerRef.current
    const next = nextCameraId(cameras, cameraId)
    // One switch at a time: a second setCamera mid-switch opens a second stream.
    if (!scanner || !next || switchingRef.current) return
    switchingRef.current = true
    try {
      await scanner.setCamera(next)
      setCameraId(next)
      if (await framesAreFlowing(videoRef.current)) {
        rememberCamera(next)
      } else if (scannerRef.current === scanner) {
        setError('That camera is not showing a picture. Try the next one.')
      }
    } catch (err) {
      console.error('Failed to switch camera:', err)
      setError('Could not switch camera. Try stopping and starting the scan again.')
    } finally {
      switchingRef.current = false
    }
  }

  const getQRTypeColor = (type: QRCodeData['type']) => {
    switch (type) {
      case 'CLOCK_IN': return 'bg-success'
      case 'CLOCK_OUT': return 'bg-destructive'
      case 'AREA': return 'bg-primary'
      case 'TASK': return 'bg-warning'
      case 'FEEDBACK': return 'bg-chart-2'
      default: return 'bg-foreground'
    }
  }

  const getActionText = (type: QRCodeData['type']) => {
    switch (type) {
      case 'CLOCK_IN': return 'Clocked In'
      case 'CLOCK_OUT': return 'Clocked Out'
      case 'AREA': return 'Area Scanned'
      case 'TASK': return 'Task Started'
      case 'FEEDBACK': return 'Feedback Recorded'
      default: return 'QR Scanned'
    }
  }

  // No separate "Enable Camera" step: the browser asks for permission when
  // Start opens the camera. The extra probe stream it used to open was one of
  // several quick open/close cycles that leave some Android cameras black.
  if (permissionState === 'denied') {
    return (
      <Card className="w-full max-w-md mx-auto rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Camera Access Denied
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Camera access is required to scan QR codes. Please enable camera permissions in your browser settings.
            </AlertDescription>
          </Alert>
          <Button onClick={() => setPermissionState('unknown')} className="w-full rounded-full text-primary-foreground bg-primary">
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Task UI is handled by parent; this component just scans

  if (clockInRequired) {
    return (
      <Card className="w-full max-w-md mx-auto rounded-3xl border-0 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_50px_-20px_rgba(0,0,0,0.15)]">
        <CardContent className="space-y-5 p-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning">
            <Clock className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-title3 font-semibold tracking-tight text-foreground">
              Clock in first
            </h2>
            <p className="text-footnote leading-snug text-muted-foreground">
              You need to clock in before scanning area or task QR codes. Tap the button
              below to clock in, then come back to scan.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => navigate('/clock-in')}
              className="h-11 w-full rounded-full bg-primary text-subheadline font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
            >
              Go to Clock In
            </Button>
            <Button
              variant="ghost"
              onClick={() => setClockInRequired(false)}
              className="h-10 w-full rounded-full text-footnote font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Show clock-out validator if requested
  if (showClockOut && showClockOutOption) {
    return (
      <ClockOutValidator
        cleanerId={cleanerId}
        cleanerName={cleanerName}
        onClockOutSuccess={() => {
          setShowClockOut(false)
          onClockOutSuccess?.()
        }}
        onCancel={() => setShowClockOut(false)}
      />
    )
  }

  return (
    <div className="w-full space-y-4">
      <div className="space-y-4">
        {/* Camera View */}
        <div className={`relative aspect-square rounded-3xl overflow-hidden border-2 ${isScanning ? 'border-primary/40 bg-foreground' : 'border-border bg-muted'} transition-all duration-200`}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-56 h-56 rounded-2xl border-2 border-border/60 shadow-[0_0_0_6000px_rgba(17,24,39,0.6)]" />
              </div>
            )}
          {wrongType && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2">
              <div className="px-3 py-1 rounded-full bg-warning/10 text-warning text-xs font-medium border border-warning/30 shadow-sm">
                {describeWrongQrType(wrongType, allowedTypes ?? [])}
              </div>
            </div>
          )}
          {!isScanning && !lastScan?.success && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                  <QrCode className="w-8 h-8 text-primary" />
                </div>
                <p className="text-muted-foreground font-medium">Hold steady and align the QR inside the frame</p>
              </div>
            </div>
          )}
          {isProcessing && isScanning && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 flex items-center justify-center bg-foreground/60"
            >
              <div className="flex items-center gap-2 rounded-full bg-background px-5 py-3 text-base font-semibold text-foreground shadow-lg">
                <Loader2 className="h-5 w-5 animate-spin" />
                Saving…
              </div>
            </div>
          )}
          {lastScan?.success && (
            <div className="absolute inset-0 flex items-center justify-center bg-success/10">
              <div className="flex items-center justify-center h-24 w-24 rounded-full bg-success/10 text-success">
                <CheckCircle2 className="h-14 w-14 animate-[scale-in_0.4s_ease-out_forwards]" />
              </div>
            </div>
          )}
        </div>

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
          <>
            {cameras.length > 1 && (
              <Button
                variant="outline"
                onClick={switchCamera}
                className="w-full rounded-full py-5 font-semibold"
              >
                <SwitchCamera className="h-5 w-5 mr-3" />
                Not scanning? Switch camera
              </Button>
            )}
            <Button 
              onClick={stopScanning} 
              variant="destructive" 
              className="w-full rounded-full py-6 text-lg font-semibold"
            >
              Stop Scanning
            </Button>
          </>
        )}

        {showClockOutOption && (
          <Button
            variant="outline"
            onClick={() => setShowClockOut(true)}
            className="w-full rounded-full py-5 text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            Clock Out
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

        {/* Success Display */}
        <style>{`
          @keyframes scale-in {
            from { transform: scale(0.6); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
}
