import React, { useEffect, useRef, useState } from 'react'
import { Camera, QrCode, AlertCircle, CheckCircle2 } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { QRService, QRCodeData } from '../../services/qrService'
import { ClockOutValidator } from './ClockOutValidator'
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
}

export const QRScanner: React.FC<QRScannerProps> = ({
  cleanerId,
  cleanerName,
  onScanSuccess,
  onScanError,
  allowedTypes,
  showClockOutOption,
  onClockOutSuccess,
  previewMode = false
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
  const [isCheckingPermission, setIsCheckingPermission] = useState(false)
  // Task selector is handled by parent workflow; do not embed here
  const [isProcessing, setIsProcessing] = useState(false)
  const [wrongType, setWrongType] = useState<QRCodeData['type'] | null>(null)
  const [showClockOut, setShowClockOut] = useState(false)

  useEffect(() => {
    return () => {
      if (qrScanner) {
        qrScanner.stop()
        qrScanner.destroy()
      }
    }
  }, [qrScanner])

  useEffect(() => {
    const checkPermission = async () => {
      if (!navigator.permissions?.query) {
        setPermissionState('prompt')
        return
      }
      try {
        setIsCheckingPermission(true)
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName })
        setPermissionState(result.state === 'prompt' ? 'prompt' : (result.state as 'granted' | 'denied'))
        result.onchange = () => {
          setPermissionState(result.state === 'prompt' ? 'prompt' : (result.state as 'granted' | 'denied'))
        }
      } catch (err) {
        console.error('Permission api error:', err)
      } finally {
        setIsCheckingPermission(false)
      }
    }
    checkPermission()
  }, [])

  const requestCameraPermission = async () => {
    try {
      setIsCheckingPermission(true)
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(track => track.stop()) // Stop the test stream
      setPermissionState('granted')
      setError(null)
    } catch (err) {
      console.error('Camera permission denied:', err)
      setPermissionState('denied')
      setError('Camera access is required to scan QR codes. Please allow camera permission.')
    } finally {
      setIsCheckingPermission(false)
    }
  }

  const startScanning = async () => {
    if (isScanning) return
    if (!videoRef.current) return

    try {
      setError(null)
      setLastScan(null)
      setIsScanning(true)

      if (qrScanner) {
        qrScanner.stop()
        qrScanner.destroy()
        setQrScanner(null)
      }

      const scanner = new QrScanner(
        videoRef.current,
        async (result) => {
          try {
            let qrData = QRService.parseQRCode(result.data)
            
            if (!qrData) {
              setError('Invalid QR code format. QR code should contain "Clock In" text or be in JSON format.')
              return
            }

            // Ignore scans that don't match allowed types for this step
            if (allowedTypes && !allowedTypes.includes(qrData.type)) {
              setWrongType(qrData.type)
              setTimeout(() => setWrongType(null), 1200)
              return
            }

            // Throttle processing to avoid duplicate spam
            if (isProcessing) return
            setIsProcessing(true)

            // Resolve canonical data from database by qr_code_id if available
            try {
              const { data: rows } = await (await import('../../services/supabase')).supabase
                .from('building_qr_codes')
                .select('qr_code_url, is_active')
                .eq('qr_code_id', qrData.id)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()
              if (rows?.qr_code_url) {
                const resolved = QRService.parseQRCode(rows.qr_code_url)
                if (resolved) {
                  qrData = resolved
                }
              }
            } catch {}

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

            // Check if this QR code should show task selector
            // Only AREA QR codes show tasks, CLOCK_IN just processes the clock in
            const shouldGoToTasks = qrData.type === 'AREA'
            if (shouldGoToTasks && !previewMode) {
              // Delegate to parent to render tasks UI; avoid duplicate headers/buttons
              stopScanning()
              onScanSuccess?.(qrData)
              setLastScan({ data: qrData, timestamp: new Date(), success: true })
            } else {
              if (previewMode) {
                stopScanning()
                setLastScan({ data: qrData, timestamp: new Date(), success: true })
                onScanSuccess?.(qrData)
              } else {
                // For CLOCK_IN flows, move forward immediately once recognized
                if (qrData.type === 'CLOCK_IN' && (!allowedTypes || allowedTypes.includes('CLOCK_IN'))) {
                  onScanSuccess?.(qrData)
                }

                // Process in the background for CLOCK_IN/CLOCK_OUT/FEEDBACK
                const result = await QRService.processQRScan(qrData, cleanerId, cleanerName, location)
                
                setLastScan({
                  data: qrData,
                  timestamp: new Date(),
                  success: result.success
                })

                if (result.success) {
                  onScanSuccess?.(qrData)
                } else {
                  const errorMessage = result.message || 'Failed to process QR code scan'
                  setError(errorMessage)
                  onScanError?.(errorMessage)
                }

                // Brief pause before allowing next scan
                setTimeout(() => {
                  setError(null)
                }, 2000)
              }
            }

          } catch (err) {
            console.error('Error processing QR scan:', err)
            setError('Error processing QR code')
            onScanError?.('Error processing QR code')
          } finally {
            setTimeout(() => setIsProcessing(false), 800)
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

  const getQRTypeColor = (type: QRCodeData['type']) => {
    switch (type) {
      case 'CLOCK_IN': return 'bg-green-500'
      case 'CLOCK_OUT': return 'bg-red-500'
      case 'AREA': return 'bg-blue-500'
      case 'TASK': return 'bg-yellow-500'
      case 'FEEDBACK': return 'bg-purple-500'
      default: return 'bg-gray-500'
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

  if (permissionState === 'unknown' || permissionState === 'prompt') {
    return (
      <Card className="w-full max-w-md mx-auto rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            QR Code Scanner
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-gray-600">Camera access is required to scan QR codes</p>
          <Button onClick={requestCameraPermission} className="w-full rounded-full text-white" style={{ backgroundColor: '#00339B' }}>
            <Camera className="h-4 w-4 mr-2" />
            Enable Camera
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (permissionState === 'denied') {
    return (
      <Card className="w-full max-w-md mx-auto rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
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
          <Button onClick={requestCameraPermission} className="w-full rounded-full text-white" style={{ backgroundColor: '#00339B' }}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Task UI is handled by parent; this component just scans

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
        <div className={`relative aspect-square rounded-3xl overflow-hidden border-2 ${isScanning ? 'border-blue-500 bg-gray-900' : 'border-gray-200 bg-gray-50'} transition-all duration-200`}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-56 h-56 rounded-2xl border-2 border-white/70 shadow-[0_0_0_6000px_rgba(17,24,39,0.6)_inset]" />
              </div>
            )}
          {wrongType && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2">
              <div className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-900 text-xs font-medium border border-yellow-300 shadow-sm">
                Wrong QR type • need {allowedTypes?.join(' / ')}
              </div>
            </div>
          )}
          {!isScanning && !lastScan?.success && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                  <QrCode className="w-8 h-8" style={{ color: '#00339B' }} />
                </div>
                <p className="text-gray-600 font-medium">Hold steady and align the QR inside the frame</p>
              </div>
            </div>
          )}
          {lastScan?.success && (
            <div className="absolute inset-0 flex items-center justify-center bg-green-500/10">
              <div className="flex items-center justify-center h-24 w-24 rounded-full bg-green-100 text-green-600">
                <CheckCircle2 className="h-14 w-14 animate-[scale-in_0.4s_ease-out_forwards]" />
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        {!isScanning ? (
          <Button 
            onClick={startScanning} 
            className="w-full rounded-full py-6 text-lg font-semibold text-white shadow-lg transition-all duration-200"
            style={{ backgroundColor: '#00339B' }}
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

        {showClockOutOption && (
          <Button
            variant="outline"
            onClick={() => setShowClockOut(true)}
            className="w-full rounded-full py-5 text-red-600 border-red-200 hover:bg-red-50"
          >
            Clock Out
          </Button>
        )}

        {/* Error Display removed per request */}

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
