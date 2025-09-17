import React, { useEffect, useRef, useState } from 'react'
import { Camera, QrCode, AlertCircle, CheckCircle2 } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { QRService, QRCodeData } from '../../services/qrService'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'

interface QRScannerProps {
  cleanerId: string
  cleanerName: string
  onScanSuccess?: (data: QRCodeData) => void
  onScanError?: (error: string) => void
}

export const QRScanner: React.FC<QRScannerProps> = ({
  cleanerId,
  cleanerName,
  onScanSuccess,
  onScanError
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
      stream.getTracks().forEach(track => track.stop()) // Stop the test stream
      setHasPermission(true)
      setError(null)
    } catch (err) {
      console.error('Camera permission denied:', err)
      setHasPermission(false)
      setError('Camera access is required to scan QR codes. Please allow camera permission.')
    }
  }

  const startScanning = async () => {
    if (!videoRef.current) return

    try {
      setError(null)
      setIsScanning(true)

      const scanner = new QrScanner(
        videoRef.current,
        async (result) => {
          try {
            const qrData = QRService.parseQRCode(result.data)
            
            if (!qrData) {
              setError('Invalid QR code format')
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

            // Process the QR scan
            const success = await QRService.processQRScan(qrData, cleanerId, cleanerName, location)
            
            setLastScan({
              data: qrData,
              timestamp: new Date(),
              success
            })

            if (success) {
              onScanSuccess?.(qrData)
            } else {
              setError('Failed to process QR code scan')
              onScanError?.('Failed to process QR code scan')
            }

            // Brief pause before allowing next scan
            setTimeout(() => {
              setError(null)
            }, 2000)

          } catch (err) {
            console.error('Error processing QR scan:', err)
            setError('Error processing QR code')
            onScanError?.('Error processing QR code')
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

  if (hasPermission === null) {
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

  if (hasPermission === false) {
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

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            QR Code Scanner
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Camera View */}
          <div className={`relative aspect-square rounded-2xl overflow-hidden border border-gray-200 shadow-sm ${isScanning ? 'bg-black' : 'bg-gray-50'}`}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-xl shadow-[0_0_0_2px_rgba(255,255,255,0.8)_inset] animate-pulse" />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            {!isScanning ? (
              <Button onClick={startScanning} className="flex-1 rounded-full text-white" style={{ backgroundColor: '#00339B' }}>
                <Camera className="h-4 w-4 mr-2" />
                Start Scanning
              </Button>
            ) : (
              <Button onClick={stopScanning} variant="destructive" className="flex-1 rounded-full">
                Stop Scanning
              </Button>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Last Scan Result */}
          {lastScan && (
            <Alert variant={lastScan.success ? "default" : "destructive"}>
              <div className="flex items-center gap-2">
                {lastScan.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={getQRTypeColor(lastScan.data.type)}>
                      {lastScan.data.type}
                    </Badge>
                    <span className="text-sm font-medium">
                      {getActionText(lastScan.data.type)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {lastScan.timestamp.toLocaleTimeString()}
                  </p>
                  {lastScan.data.metadata?.areaName && (
                    <p className="text-xs text-gray-600">
                      Area: {lastScan.data.metadata.areaName}
                    </p>
                  )}
                </div>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
