import React, { useState, useEffect } from 'react'
import { Clock, Camera } from 'lucide-react'
import { QRCodeData } from '../../services/qrService'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import type { SendOutcome } from '@/lib/clock/outbox'
import { QrCamera } from '@/components/qr/scanner/QrCamera'
import { ClockNoticePanel } from '../clock/ClockNoticePanel'
import { useClockOutV2 } from '../clock/useClockOutV2'

interface ClockOutValidatorProps {
  cleanerId: string
  cleanerName: string
  // Called with the outcome once the attempt is over (saved, kept on the phone,
  // or the shift was already closed).
  onClockOutSuccess?: (outcome: SendOutcome) => void
  onCancel?: () => void
  // A Clock Out code already scanned on another screen: clock out with it straight away
  pendingQrData?: QRCodeData | null
}

/**
 * The clock-out screen. The scan goes to the outbox and the clock_out RPC
 * (useClockOutV2); the server writes the shift, cleaner_logs and live_tracking.
 */
export const ClockOutValidator: React.FC<ClockOutValidatorProps> = ({
  cleanerId,
  cleanerName,
  onClockOutSuccess,
  onCancel,
  pendingQrData
}) => {
  const v2 = useClockOutV2({ cleanerId, cleanerName, onFinished: (outcome) => onClockOutSuccess?.(outcome) })
  const [isScanning, setIsScanning] = useState(false)

  const stopScanning = () => setIsScanning(false)

  // <QrCamera/> owns the camera, so Start only turns it on. GPS starts with it.
  const startScanning = () => {
    v2.setNotice(null)
    v2.startLocation()
    setIsScanning(true)
  }

  useEffect(() => {
    if (!pendingQrData) return
    // The area scanner hands over the poster's own text; the server parses it.
    // Keeps the time the code was read on the area screen, not the hand-over time.
    const { rawPayload, scannedAtMs, ...parsed } = pendingQrData
    void v2.submit(rawPayload ?? JSON.stringify(parsed), scannedAtMs ?? Date.now())
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
          <QrCamera
            active={isScanning}
            paused={v2.saving}
            onDecode={(text) => void v2.handleText(text, stopScanning)}
            onDiagnostics={(d) => {
              v2.diagnosticsRef.current = d
            }}
            className="border-destructive/40"
          />

          {v2.saving && (
            <div role="status" className="flex items-center justify-center gap-2 rounded-2xl bg-muted p-4 font-semibold">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-transparent" />
              Clocking you out…
            </div>
          )}

          {v2.notice && !v2.saving && (
            <>
              <ClockNoticePanel
                notice={v2.notice}
                secondary={{
                  label: 'Scan again',
                  onClick: () => {
                    v2.setNotice(null)
                    if (!isScanning) startScanning()
                  },
                }}
                onDismiss={() => v2.setNotice(null)}
              />
              {onCancel && !isScanning && (
                <Button variant="outline" onClick={onCancel} className="w-full rounded-full">
                  Cancel
                </Button>
              )}
            </>
          )}

          {/* Controls */}
          {!isScanning && !v2.saving && !v2.notice ? (
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
