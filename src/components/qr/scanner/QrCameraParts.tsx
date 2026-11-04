import React from 'react'
import { AlertCircle, Camera, CameraOff, Flashlight, FlashlightOff, Loader2, RotateCcw, SwitchCamera, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ScanView } from '@/lib/scanner/scanSession'

/** Four corner marks round the target. No dark mask: the code itself stays bright. */
export const ScanFrame: React.FC = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
    <div className="relative h-[64%] w-[64%]">
      {[
        'left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl',
        'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl',
        'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl',
        'right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl',
      ].map((corner) => (
        <span key={corner} className={cn('absolute h-10 w-10 border-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]', corner)} />
      ))}
    </div>
  </div>
)

const Panel: React.FC<{ children: React.ReactNode; tone?: 'dark' | 'light' }> = ({ children, tone = 'light' }) => (
  <div
    role="status"
    aria-live="polite"
    className={cn(
      'absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center',
      tone === 'light' ? 'bg-muted text-foreground' : 'bg-foreground/70 text-background',
    )}
  >
    {children}
  </div>
)

const RetryButton: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <Button onClick={onRetry} className="h-11 rounded-full px-6 text-subheadline font-semibold">
    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
    Try again
  </Button>
)

const PermissionHelp: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <Panel>
    <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
    <h2 className="text-title3 font-semibold tracking-tight">Camera access is blocked</h2>
    <div className="space-y-2 text-left text-footnote leading-snug text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">On Android (Chrome):</span> tap the icon to the left of the web
        address, tap Permissions, turn Camera on, then tap Try again.
      </p>
      <p>
        <span className="font-semibold text-foreground">On iPhone (Safari):</span> tap aA in the address bar, tap Website
        Settings, set Camera to Allow, then tap Try again. Using the app from your Home Screen? Open Settings, then Safari,
        then Camera, and choose Allow.
      </p>
    </div>
    <RetryButton onRetry={onRetry} />
  </Panel>
)

export const StatusPanel: React.FC<{ view: ScanView; onRetry: () => void }> = ({ view, onRetry }) => {
  switch (view.status) {
    case 'starting':
      return (
        <Panel tone="dark">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-subheadline font-semibold">Starting camera…</p>
          {view.slowStart && (
            <>
              <p className="text-footnote">
                This is taking a while. If your phone asked about the camera, tap Allow.
              </p>
              <RetryButton onRetry={onRetry} />
            </>
          )}
        </Panel>
      )
    case 'no-picture':
      return (
        <Panel>
          <CameraOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-title3 font-semibold tracking-tight">The camera is not showing a picture</h2>
          <p className="text-footnote leading-snug text-muted-foreground">
            Close other apps that use the camera, then try again. Or take a photo of the code instead.
          </p>
          <RetryButton onRetry={onRetry} />
        </Panel>
      )
    case 'denied':
      return <PermissionHelp onRetry={onRetry} />
    case 'no-camera':
      return (
        <Panel>
          <CameraOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-title3 font-semibold tracking-tight">No camera found on this device</h2>
          <p className="text-footnote leading-snug text-muted-foreground">You can still take a photo of the code.</p>
        </Panel>
      )
    default:
      return null
  }
}

interface LiveControlsProps {
  view: ScanView
  onSwitch: () => void
  onTorch: () => void
  onZoom: () => void
}

/** Switch camera, torch and zoom: only what this camera supports, only once it is live. */
export const LiveControls: React.FC<LiveControlsProps> = ({ view, onSwitch, onTorch, onZoom }) => {
  if (view.status !== 'live') return null
  const torchOn = view.torch === 'on'
  const zoomOn = view.zoom === 'on'
  const any = view.canSwitch || view.torch !== 'unsupported' || view.zoom !== 'unsupported'
  if (!any) return null
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {view.canSwitch && (
        <Button variant="outline" onClick={onSwitch} className="h-11 rounded-full px-5 font-semibold">
          <SwitchCamera className="mr-2 h-5 w-5" aria-hidden="true" />
          Switch camera
        </Button>
      )}
      {view.torch !== 'unsupported' && (
        <Button
          variant="outline"
          onClick={onTorch}
          aria-pressed={torchOn}
          aria-label={torchOn ? 'Turn light off' : 'Turn light on'}
          className={cn('h-11 rounded-full px-5 font-semibold', torchOn && 'border-warning bg-warning/10')}
        >
          {torchOn ? (
            <FlashlightOff className="mr-2 h-5 w-5" aria-hidden="true" />
          ) : (
            <Flashlight className="mr-2 h-5 w-5" aria-hidden="true" />
          )}
          Light
        </Button>
      )}
      {view.zoom !== 'unsupported' && (
        <Button
          variant="outline"
          onClick={onZoom}
          aria-pressed={zoomOn}
          className={cn('h-11 rounded-full px-5 font-semibold', zoomOn && 'border-primary bg-primary/10')}
        >
          <ZoomIn className="mr-2 h-5 w-5" aria-hidden="true" />
          Zoom 2×
        </Button>
      )}
    </div>
  )
}

interface PhotoFallbackProps {
  view: ScanView
  onPick: () => void
}

/** "Take a photo" uses the phone's own camera app, so it works even when the live preview can't. */
export const PhotoFallback: React.FC<PhotoFallbackProps> = ({ view, onPick }) => {
  const prominent = view.watchdogFailed || view.status === 'no-camera' || view.status === 'denied' || view.slowStart
  const busy = view.photo === 'decoding'
  return (
    <div className="space-y-2">
      <Button
        variant={prominent ? 'default' : 'link'}
        onClick={onPick}
        disabled={busy}
        data-prominent={prominent ? 'true' : 'false'}
        className={cn(
          'w-full rounded-full font-semibold',
          prominent ? 'h-12 text-subheadline text-primary-foreground' : 'h-auto whitespace-normal py-2 text-footnote',
        )}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {busy ? 'Reading the photo…' : prominent ? 'Take a photo of the code' : 'Camera not showing? Take a photo of the code'}
      </Button>
      {view.photo === 'not-found' && (
        <p role="alert" className="text-center text-footnote text-destructive">
          No QR code found in that photo. Take it closer, with the whole code in the picture.
        </p>
      )}
      {view.photo === 'failed' && (
        <p role="alert" className="text-center text-footnote text-destructive">
          That photo could not be read. Please try again.
        </p>
      )}
      {view.photo === 'timeout' && (
        <p role="alert" className="text-center text-footnote text-destructive">
          The scanner is still loading. Check your signal, then try the photo again.
        </p>
      )}
      {view.photo === 'busy' && (
        <p role="status" className="text-center text-footnote text-muted-foreground">
          Still saving your last scan — try again in a moment
        </p>
      )}
    </div>
  )
}
