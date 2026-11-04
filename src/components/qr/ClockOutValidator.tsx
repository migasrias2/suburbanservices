import React, { useState, useRef, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Clock, QrCode, Camera, X, SwitchCamera } from 'lucide-react'
import QrScanner from 'qr-scanner'
import {
  activeCameraId,
  framesAreFlowing,
  nextCameraId,
  pickScanCamera,
  readRememberedCamera,
  releaseScanner,
  rememberCamera,
  REOPEN_GAP_MS,
  sleep,
  type CameraOption,
} from '@/lib/cameraChoice'
import { QRService, QRCodeData } from '../../services/qrService'
import { clearDraft } from '../../lib/offlineStore'
import { supabase } from '../../services/supabase'
import { reportClockFailure } from '../../services/clockFailureService'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'

interface ClockOutValidatorProps {
  cleanerId: string
  cleanerName: string
  onClockOutSuccess?: () => void
  onCancel?: () => void
  // A Clock Out code already scanned on another screen: clock out with it straight away
  pendingQrData?: QRCodeData | null
}

export const ClockOutValidator: React.FC<ClockOutValidatorProps> = ({
  cleanerId,
  cleanerName,
  onClockOutSuccess,
  onCancel,
  pendingQrData
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [qrScanner, setQrScanner] = useState<QrScanner | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    message: string
    qrData?: QRCodeData
  } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [cameras, setCameras] = useState<CameraOption[]>([])
  const [cameraId, setCameraId] = useState<string | null>(null)
  // The scan callback is built once, so state read inside it is frozen; refs are not.
  const scannerRef = useRef<QrScanner | null>(null)
  // A double tap lands before React re-renders; two scanners would fight over one video.
  const startingRef = useRef(false)
  // Bumped by Stop and by leaving the screen; a start that sees it change after
  // an await was cancelled and must release what it opened.
  const startGenRef = useRef(0)
  // When the last scanner was released; see REOPEN_GAP_MS.
  const lastReleaseAtRef = useRef(0)
  const switchingRef = useRef(false)
  const submittingRef = useRef(false)
  // The camera callback fires several times a second; one record per reason is enough.
  const lastReportRef = useRef<{ reason: string; at: number } | null>(null)

  const reportFailure = (reason: string, qrData?: QRCodeData) => {
    const now = Date.now()
    const last = lastReportRef.current
    if (last && last.reason === reason && now - last.at < 30_000) return
    lastReportRef.current = { reason, at: now }
    void reportClockFailure({
      eventType: 'clock_out',
      reason,
      cleanerName,
      qrCodeId: qrData?.id ?? null,
      customerName: qrData?.customerName ?? null,
    })
  }

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

  // Released now, not on qr-scanner's 300 ms stop() timer, so the camera
  // light goes off at once.
  const releaseNow = (scanner: QrScanner) => {
    lastReleaseAtRef.current = performance.now()
    void releaseScanner(scanner)
    if (scannerRef.current === scanner) {
      scannerRef.current = null
      setQrScanner(null)
    }
  }

  // Same lens choice as the clock-in scanner. Plain 'environment' opens the
  // ultra-wide on many Samsungs, which can't focus on a code at arm's length.
  // There is no "Enable Camera" probe first: the browser asks when the camera
  // opens, and each extra open/close is a chance for the camera to go black.
  const startScanning = async () => {
    if (startingRef.current || scannerRef.current || !videoRef.current) return
    startingRef.current = true
    startGenRef.current += 1
    const generation = startGenRef.current
    const isCurrent = () => startGenRef.current === generation
    let created: QrScanner | null = null

    try {
      setError(null)
      setValidationResult(null)
      setIsScanning(true)
      // The switch button waits until this start has opened the camera.
      setCameras([])

      // Labels are only readable before start() if permission was granted earlier.
      const chosenCamera = pickScanCamera(
        await QrScanner.listCameras(false).catch(() => [] as CameraOption[]),
        readRememberedCamera(),
      )
      // Wait out the last scanner's release timer before opening on this video.
      const wait = lastReleaseAtRef.current + REOPEN_GAP_MS - performance.now()
      if (wait > 0) await sleep(wait)
      // Stopped, or the screen was left, while we waited.
      const video = videoRef.current
      if (!isCurrent() || !video) return

      const scanner = new QrScanner(
        video,
        async (result) => {
          try {
            let qrData = QRService.parseQRCode(result.data)
            
            if (!qrData) {
              setValidationResult({
                valid: false,
                message: 'Invalid QR code format'
              })
              reportFailure('Scanned a code that is not a valid QR format')
              return
            }

            const scannedType = QRService.normalizeQrType(qrData.type)

            // Resolve canonical payload when possible, but keep scan type if DB metadata is stale.
            try {
              const { data: dbRow } = await supabase
                .from('building_qr_codes')
                .select('qr_code_url')
                .eq('qr_code_id', qrData.id)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()

              if (dbRow?.qr_code_url) {
                const resolved = QRService.parseQRCode(dbRow.qr_code_url)
                if (resolved) {
                  const resolvedType = QRService.normalizeQrType(resolved.type)
                  if (scannedType && resolvedType && scannedType !== resolvedType) {
                    qrData = { ...resolved, type: scannedType }
                  } else {
                    qrData = resolved
                  }
                }
              }
            } catch {
              // Ignore metadata lookup errors and continue with scanned payload.
            }

            const normalizedType = QRService.normalizeQrType(qrData.type)
            // Validate that this is a clock out QR code
            if (normalizedType !== 'CLOCK_OUT') {
              setValidationResult({
                valid: false,
                message: 'This is not a valid clock out QR code'
              })
              reportFailure(`Scanned a ${normalizedType ?? 'unknown'} code instead of a clock-out code`, qrData)
              return
            }

            // Additional validation logic can be added here
            // For example, checking if the location matches, time constraints, etc.
            
            const clockOutData = normalizedType ? { ...qrData, type: normalizedType } : qrData
            setValidationResult({
              valid: true,
              message: 'Clock Out code found. Clocking you out…',
              qrData: clockOutData
            })
            stopScanning()
            // Clock out on the scan itself. It used to wait for a separate
            // "Confirm Clock Out" tap; a cleaner who saw the green VALID badge
            // and put the phone away was never clocked out, and nothing was logged.
            void submitClockOut(clockOutData)

          } catch (err) {
            console.error('Error processing QR scan:', err)
            setValidationResult({
              valid: false,
              message: 'Error processing QR code'
            })
          }
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: chosenCamera ?? 'environment',
        }
      )

      // Registered before start() so Stop and leaving the screen can always
      // release the camera, even if start() stalls.
      created = scanner
      scannerRef.current = scanner
      setQrScanner(scanner)
      await scanner.start()
      if (!isCurrent()) {
        releaseNow(scanner)
        return
      }

      // The camera is open, so labels are readable now for the switch button.
      const openCameras = await QrScanner.listCameras(false).catch(() => [] as CameraOption[])
      if (!isCurrent()) return
      setCameras(openCameras)
      setCameraId(activeCameraId(videoRef.current) ?? chosenCamera)
    } catch (err) {
      // Only the scanner this start created: once cancelled, scannerRef may
      // already belong to a newer start.
      if (created) releaseNow(created)
      if (!isCurrent()) return
      console.error('Error starting QR scanner:', err)
      setError('Failed to start camera. Please check your camera permissions.')
      reportFailure(`Camera did not start: ${err instanceof Error ? err.message : String(err)}`)
      setIsScanning(false)
    } finally {
      if (isCurrent()) startingRef.current = false
    }
  }

  // Way out when the chosen lens still can't read the code.
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

  const stopScanning = () => {
    startGenRef.current += 1
    startingRef.current = false
    const scanner = scannerRef.current ?? qrScanner
    if (scanner) releaseNow(scanner)
    scannerRef.current = null
    setQrScanner(null)
    setIsScanning(false)
  }

  const handleClockOut = async () => {
    if (!validationResult?.valid || !validationResult.qrData) return
    await submitClockOut(validationResult.qrData)
  }

  const submitClockOut = async (clockOutData: QRCodeData) => {
    if (submittingRef.current) return
    submittingRef.current = true
    let succeeded = false
    setIsProcessing(true)
    setError(null)

    try {
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

      // Process the clock out
      const result = await QRService.processQRScan(
        clockOutData,
        cleanerId,
        cleanerName,
        location
      )

      if (result.success) {
        succeeded = true
        // Finalize and clear any persisted drafts so we don't auto-resume tasks
        try { await QRService.finalizeRemoteDraft(cleanerId) } catch {}
        try { await clearDraft() } catch {}
        // Mark recent clock out to avoid immediate server reconciliation flipping us back
        try { localStorage.setItem('recentClockOutAt', String(Date.now())) } catch {}
        // Deactivate live tracking. There is deliberately no "force-close every
        // open shift with this name" any more: it closed other people's shifts
        // and forgotten earlier ones at this moment's time, inflating hours.
        try {
          await supabase
            .from('live_tracking')
            .update({ is_active: false, event_type: 'clock_out' })
            .eq('cleaner_id', cleanerId)
            .eq('is_active', true)
        } catch {}
        onClockOutSuccess?.()
      } else {
        setError(result.message || 'Failed to process clock out. Please try again.')
      }
    } catch (err) {
      console.error('Error during clock out:', err)
      setError('An error occurred while clocking out.')
      reportFailure(`Clock-out threw: ${err instanceof Error ? err.message : String(err)}`, clockOutData)
    } finally {
      // Stay locked after a success: a straggling scan callback must not
      // clock out a second time. Only a failure may be retried.
      if (!succeeded) submittingRef.current = false
      setIsProcessing(false)
    }
  }

  useEffect(() => {
    if (!pendingQrData) return
    setValidationResult({
      valid: true,
      message: 'Clock Out code found. Clocking you out…',
      qrData: pendingQrData
    })
    void submitClockOut(pendingQrData)
    // Run once for the code handed over on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 mx-auto bg-destructive/10 rounded-full flex items-center justify-center">
          <Clock className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Clock Out</h1>
        <p className="text-muted-foreground">
          Scan the Clock Out QR code to finish your shift
        </p>
      </div>

      <Card className="rounded-3xl border-0 shadow-lg overflow-hidden">
        <CardContent className="p-6 space-y-4">
          {/* Camera View */}
          <div className={`relative aspect-square rounded-3xl overflow-hidden border-2 ${
            isScanning 
              ? 'border-destructive/40 bg-black' 
              : 'border-border bg-muted'
          } transition-all duration-200`}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-56 h-56 rounded-2xl border-2 border-border border-opacity-80 animate-pulse shadow-lg" />
              </div>
            )}
            {!isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 mx-auto bg-destructive/10 rounded-full flex items-center justify-center">
                    <QrCode className="w-8 h-8 text-destructive" />
                  </div>
                  <p className="text-muted-foreground font-medium">Ready to scan clock out QR</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {!isScanning && !validationResult ? (
            <Button 
              onClick={startScanning} 
              className="w-full rounded-full py-4 text-lg font-semibold bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg transition-all duration-200"
            >
              <Camera className="h-5 w-5 mr-3" />
              Start Scanning
            </Button>
          ) : isScanning ? (
            <>
              {cameras.length > 1 && (
                <Button
                  variant="outline"
                  onClick={switchCamera}
                  className="w-full rounded-full py-4 font-semibold"
                >
                  <SwitchCamera className="h-5 w-5 mr-3" />
                  Not scanning? Switch camera
                </Button>
              )}
              <Button 
                onClick={stopScanning} 
                variant="outline" 
                className="w-full rounded-full py-4 text-lg font-semibold border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                Stop Scanning
              </Button>
            </>
          ) : null}

          {/* Validation Result */}
          {validationResult && (
            <Alert className={`rounded-2xl ${validationResult.valid ? 'border-success/30 bg-success/10' : 'border-destructive/30 bg-destructive/10'}`}>
              {validationResult.valid ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${validationResult.valid ? 'text-success' : 'text-destructive'}`}>
                    {validationResult.message}
                  </span>
                  {validationResult.valid && (
                    <Badge className="bg-success text-success-foreground">
                      VALID
                    </Badge>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant="destructive" className="rounded-2xl">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          {validationResult && (
            <div className="flex gap-3 pt-2">
              {validationResult.valid ? (
                <Button
                  onClick={handleClockOut}
                  disabled={isProcessing}
                  className="flex-1 rounded-full py-4 text-lg font-semibold bg-success hover:bg-success/90 text-success-foreground shadow-lg"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-border border-t-transparent rounded-full animate-spin" />
                      Processing...
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      {error ? 'Try Clock Out Again' : 'Clock Out'}
                    </div>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => setValidationResult(null)}
                  className="flex-1 rounded-full py-4 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Try Again
                </Button>
              )}
              
              <Button 
                onClick={onCancel}
                variant="outline"
                className="px-6 rounded-full py-4 border-border text-muted-foreground hover:bg-muted"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Make sure you're scanning the correct Clock Out QR code for your location
        </p>
      </div>
    </div>
  )
}
