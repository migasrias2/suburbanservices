/**
 * The one camera component for every scan screen (P4, behind `scanner_v2`).
 *
 * It owns the camera and the decoder and hands decoded text to `onDecode`.
 * What the text means (clock in, clock out, area, dedupe across saves, errors)
 * stays in the parent. Identical decodes within ~1.5 s are dropped here, so a
 * poster held in view isn't reported 8 times a second.
 */
import React, { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createCameraController } from '@/lib/scanner/cameraController'
import { decodeFrame, decodeImage, getDecoderInfo, warmUpDecoder } from '@/lib/scanner/decoder'
import {
  createScanSession,
  INITIAL_VIEW,
  type ScanSession,
  type ScanTimings,
  type ScanView,
} from '@/lib/scanner/scanSession'
import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'
import { LiveControls, PhotoFallback, ScanFrame, StatusPanel } from './QrCameraParts'

export interface QrCameraProps {
  /** Camera on while true. Turning it false releases the camera at once. */
  active: boolean
  /** Decoded QR text, from the live camera or a photo. */
  onDecode: (text: string) => void
  /** Stop decoding (camera stays on) while the parent saves a scan. */
  paused?: boolean
  /** Latest facts about this session, for the caller to send to the server. The last call is the final one. */
  onDiagnostics?: (diagnostics: ScanDiagnostics) => void
  /** Drawn over the camera picture (e.g. the parent's "Saving…"). */
  overlay?: React.ReactNode
  className?: string
  /** Tests only: shorter clocks. */
  timings?: Partial<ScanTimings>
}

const scanDecoder = { decodeFrame, decodeImage, getDecoderInfo }

export const QrCamera: React.FC<QrCameraProps> = ({
  active,
  onDecode,
  paused = false,
  onDiagnostics,
  overlay,
  className,
  timings,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<ScanSession | null>(null)
  const [view, setView] = useState<ScanView>(INITIAL_VIEW)

  // The session is built once per mount; these keep its callbacks current.
  const onDecodeRef = useRef(onDecode)
  const onDiagnosticsRef = useRef(onDiagnostics)
  const pausedRef = useRef(paused)
  const timingsRef = useRef(timings)
  useEffect(() => {
    onDecodeRef.current = onDecode
    onDiagnosticsRef.current = onDiagnostics
  }, [onDecode, onDiagnostics])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const controller = createCameraController(video, { gapMs: timingsRef.current?.reopenGapMs })
    const session = createScanSession({
      video,
      controller,
      decoder: scanDecoder,
      timings: timingsRef.current,
      paused: pausedRef.current,
      onView: setView,
      onDecode: (text) => onDecodeRef.current(text),
      onDiagnostics: (d) => onDiagnosticsRef.current?.(d),
    })
    sessionRef.current = session
    return () => {
      sessionRef.current = null
      session.dispose()
      controller.dispose()
    }
  }, [])

  useEffect(() => {
    const session = sessionRef.current
    if (!session) return
    if (active) {
      void warmUpDecoder()
      void session.start()
    } else {
      session.stop()
    }
  }, [active])

  useEffect(() => {
    pausedRef.current = paused
    sessionRef.current?.setPaused(paused)
  }, [paused])

  const onPhotoChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared so choosing the same photo again still fires a change.
    event.target.value = ''
    if (file) void sessionRef.current?.decodePhoto(file)
  }

  const live = view.status === 'live'

  return (
    <div
      className={cn('w-full space-y-3', className)}
      data-testid="qr-camera"
      data-status={view.status}
      role="region"
      aria-label="QR code scanner"
    >
      <div
        className={cn(
          'relative aspect-square overflow-hidden rounded-3xl border-2 transition-colors duration-200',
          active ? 'border-primary/40 bg-foreground' : 'border-border bg-muted',
        )}
      >
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          aria-label="Camera preview"
        />
        {live && <ScanFrame />}
        {live && !overlay && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-foreground/60 px-3 py-1 text-footnote font-medium text-background">
            Point the camera at the QR code
          </p>
        )}
        {active && <StatusPanel view={view} onRetry={() => void sessionRef.current?.retry()} />}
        {overlay}
      </div>

      {active && view.decoderTrouble && (
        <p role="status" className="text-center text-footnote text-muted-foreground">
          The scanner is still loading. Check your signal, or wait a moment.
        </p>
      )}

      {active && (
        <LiveControls
          view={view}
          onSwitch={() => void sessionRef.current?.switchCamera()}
          onTorch={() => void sessionRef.current?.toggleTorch()}
          onZoom={() => void sessionRef.current?.toggleZoom()}
        />
      )}

      {active && <PhotoFallback view={view} onPick={() => photoInputRef.current?.click()} />}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="qr-photo-input"
        onChange={onPhotoChosen}
      />
    </div>
  )
}

export default QrCamera
