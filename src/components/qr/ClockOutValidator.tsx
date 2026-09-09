import React, { useState, useRef, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Clock, QrCode, Camera, X } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { QRService, QRCodeData } from '../../services/qrService'
import { clearDraft } from '../../lib/offlineStore'
import { normalizeCleanerName } from '../../lib/identity'
import { supabase } from '../../services/supabase'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'

interface ClockOutValidatorProps {
  cleanerId: string
  cleanerName: string
  onClockOutSuccess?: () => void
  onCancel?: () => void
}

export const ClockOutValidator: React.FC<ClockOutValidatorProps> = ({
  cleanerId,
  cleanerName,
  onClockOutSuccess,
  onCancel
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
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)

  useEffect(() => {
    return () => {
      if (qrScanner) {
        qrScanner.stop()
        qrScanner.destroy()
      }
    }
  }, [qrScanner])

  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(track => track.stop())
      setHasPermission(true)
      setError(null)
    } catch (err) {
      console.error('Camera permission denied:', err)
      setHasPermission(false)
      setError('Camera access is required to scan QR codes.')
    }
  }

  const startScanning = async () => {
    if (!videoRef.current) return

    try {
      setError(null)
      setValidationResult(null)
      setIsScanning(true)

      const scanner = new QrScanner(
        videoRef.current,
        async (result) => {
          try {
            let qrData = QRService.parseQRCode(result.data)
            
            if (!qrData) {
              setValidationResult({
                valid: false,
                message: 'Invalid QR code format'
              })
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
              return
            }

            // Additional validation logic can be added here
            // For example, checking if the location matches, time constraints, etc.
            
            setValidationResult({
              valid: true,
              message: 'Valid clock out QR code detected',
              qrData: normalizedType ? { ...qrData, type: normalizedType } : qrData
            })

            // Stop scanning after successful validation
            stopScanning()

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
        }
      )

      await scanner.start()
      setQrScanner(scanner)
      
    } catch (err) {
      console.error('Error starting QR scanner:', err)
      setError('Failed to start camera. Please check your camera permissions.')
      setIsScanning(false)
    }
  }

  const stopScanning = () => {
    if (qrScanner) {
      qrScanner.stop()
      setQrScanner(null)
    }
    setIsScanning(false)
  }

  const handleClockOut = async () => {
    if (!validationResult?.valid || !validationResult.qrData) return

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
        validationResult.qrData,
        cleanerId,
        cleanerName,
        location
      )

      if (result.success) {
        // Finalize and clear any persisted drafts so we don't auto-resume tasks
        try { await QRService.finalizeRemoteDraft(cleanerId) } catch {}
        try { await clearDraft() } catch {}
        // Mark recent clock out to avoid immediate server reconciliation flipping us back
        try { localStorage.setItem('recentClockOutAt', String(Date.now())) } catch {}
        // Force-close any lingering open attendance records and deactivate live tracking
        try {
          const nowIso = new Date().toISOString()
          const normalizedName = normalizeCleanerName(cleanerName)
          await supabase
            .from('time_attendance')
            .update({ clock_out: nowIso })
            .eq('cleaner_name', normalizedName)
            .is('clock_out', null)
          await supabase
            .from('time_attendance')
            .update({ clock_out: nowIso })
            .eq('cleaner_name', normalizedName)
            .eq('clock_out', '')
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
    } finally {
      setIsProcessing(false)
    }
  }

  if (hasPermission === null) {
    return (
      <Card className="w-full max-w-md mx-auto rounded-3xl border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-center justify-center">
            <Clock className="h-6 w-6 text-destructive" />
            Clock Out Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">Camera access is required to scan the clock out QR code</p>
          <Button 
            onClick={requestCameraPermission} 
            className="w-full rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground py-3"
          >
            <Camera className="h-4 w-4 mr-2" />
            Enable Camera
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (hasPermission === false) {
    return (
      <Card className="w-full max-w-md mx-auto rounded-3xl border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-center justify-center text-destructive">
            <AlertCircle className="h-6 w-6" />
            Camera Access Required
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive" className="rounded-2xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Camera access is required to scan the clock out QR code. Please enable camera permissions.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button 
              onClick={requestCameraPermission} 
              className="flex-1 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Try Again
            </Button>
            <Button 
              onClick={onCancel} 
              variant="outline"
              className="flex-1 rounded-full"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

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
            <Button 
              onClick={stopScanning} 
              variant="outline" 
              className="w-full rounded-full py-4 text-lg font-semibold border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              Stop Scanning
            </Button>
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
                      Confirm Clock Out
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
