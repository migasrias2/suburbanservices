/* eslint-disable react-refresh/only-export-components -- a test helper, never hot-reloaded */
import React, { useEffect } from 'react'
import type { QrCameraProps } from '@/components/qr/scanner/QrCamera'
import { startDiagnostics, withPatch, type ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'

/**
 * Stand-in for <QrCamera/> in screen tests: no camera, no decoder. A test
 * "points the phone at a code" with emitScan(text), which reaches the screen
 * exactly as a real decode would (and only while the camera is on and not paused).
 */
export const fakeCamera: {
  onDecode: ((text: string) => void) | null
  active: boolean
  paused: boolean
  mounts: number
} = { onDecode: null, active: false, paused: false, mounts: 0 }

export const FAKE_DIAGNOSTICS: ScanDiagnostics = withPatch(
  startDiagnostics({ userAgent: 'test-agent', platform: 'android', startedAt: 0 }),
  { cameraCount: 2, timeToFirstFrameMs: 300, decodes: 1, outcome: 'decoded' },
)

export function FakeQrCamera(props: QrCameraProps) {
  fakeCamera.onDecode = props.onDecode
  fakeCamera.active = props.active
  fakeCamera.paused = Boolean(props.paused)
  const { active, onDiagnostics } = props

  useEffect(() => {
    fakeCamera.mounts += 1
  }, [])

  useEffect(() => {
    if (active) onDiagnostics?.(FAKE_DIAGNOSTICS)
  }, [active, onDiagnostics])

  return (
    <div data-testid="qr-camera" data-active={String(props.active)} data-paused={String(Boolean(props.paused))}>
      {props.overlay}
    </div>
  )
}

/** Returns false when the camera wasn't on (or was paused), like a real camera that can't see. */
export function emitScan(text: string): boolean {
  if (!fakeCamera.active || fakeCamera.paused || !fakeCamera.onDecode) return false
  fakeCamera.onDecode(text)
  return true
}

export function resetFakeCamera(): void {
  fakeCamera.onDecode = null
  fakeCamera.active = false
  fakeCamera.paused = false
  fakeCamera.mounts = 0
}
