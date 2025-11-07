import React, { useState, useRef, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Clock, QrCode, Camera, X } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { QRService, QRCodeData } from '../../services/qrService'
import { clearDraft } from '../../lib/offlineStore'
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
            const qrData = QRService.parseQRCode(result.data)
            
            if (!qrData) {
              setValidationResult({
                valid: false,
                message: 'Invalid QR code format'
              })
              return
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
          await supabase
            .from('time_attendance')
            .update({ clock_out: nowIso })
            .eq('cleaner_name', cleanerName)
            .is('clock_out', null)
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
            <Clock className="h-6 w-6 text-red-600" />
            Clock Out Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-gray-600">Camera access is required to scan the clock out QR code</p>
          <Button 
            onClick={requestCameraPermission} 
            className="w-full rounded-full bg-red-600 hover:bg-red-700 text-white py-3"
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
          <CardTitle className="flex items-center gap-3 text-center justify-center text-red-600">
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
              className="flex-1 rounded-full bg-red-600 hover:bg-red-700 text-white"
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
        <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
          <Clock className="w-8 h-8 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Clock Out</h1>
        <p className="text-gray-600">
          Scan the Clock Out QR code to finish your shift
        </p>
      </div>

      <Card className="rounded-3xl border-0 shadow-lg overflow-hidden">
        <CardContent className="p-6 space-y-4">
          {/* Camera View */}
          <div className={`relative aspect-square rounded-3xl overflow-hidden border-2 ${
            isScanning 
              ? 'border-red-500 bg-black' 
              : 'border-gray-200 bg-gray-50'
          } transition-all duration-200`}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-56 h-56 rounded-2xl border-2 border-white border-opacity-80 animate-pulse shadow-lg" />
              </div>
            )}
            {!isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                    <QrCode className="w-8 h-8 text-red-600" />
                  </div>
                  <p className="text-gray-600 font-medium">Ready to scan clock out QR</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {!isScanning && !validationResult ? (
            <Button 
              onClick={startScanning} 
              className="w-full rounded-full py-4 text-lg font-semibold bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white shadow-lg transition-all duration-200"
            >
              <Camera className="h-5 w-5 mr-3" />
              Start Scanning
            </Button>
          ) : isScanning ? (
            <Button 
              onClick={stopScanning} 
              variant="outline" 
              className="w-full rounded-full py-4 text-lg font-semibold border-red-200 text-red-600 hover:bg-red-50"
            >
              Stop Scanning
            </Button>
          ) : null}

          {/* Validation Result */}
          {validationResult && (
            <Alert className={`rounded-2xl ${validationResult.valid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              {validationResult.valid ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600" />
              )}
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${validationResult.valid ? 'text-green-900' : 'text-red-900'}`}>
                    {validationResult.message}
                  </span>
                  {validationResult.valid && (
                    <Badge className="bg-green-600 text-white">
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
                  className="flex-1 rounded-full py-4 text-lg font-semibold bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white shadow-lg"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
                  className="flex-1 rounded-full py-4 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Try Again
                </Button>
              )}
              
              <Button 
                onClick={onCancel}
                variant="outline"
                className="px-6 rounded-full py-4 border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center">
        <p className="text-sm text-gray-500">
          Make sure you're scanning the correct Clock Out QR code for your location
        </p>
      </div>
    </div>
  )
}
