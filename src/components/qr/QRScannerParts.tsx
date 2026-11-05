import React from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

/** Presentational pieces of QRScanner, moved out so the scanner file stays readable. */

export const SavingOverlay: React.FC = () => (
  <div role="status" aria-live="polite" className="absolute inset-0 flex items-center justify-center bg-foreground/60">
    <div className="flex items-center gap-2 rounded-full bg-background px-5 py-3 text-base font-semibold text-foreground shadow-lg">
      <Loader2 className="h-5 w-5 animate-spin" />
      Saving…
    </div>
  </div>
)

export const ClockInRequiredCard: React.FC<{ onGoToClockIn: () => void; onCancel: () => void }> = ({
  onGoToClockIn,
  onCancel,
}) => (
  <Card className="w-full max-w-md mx-auto rounded-3xl border-0 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_50px_-20px_rgba(0,0,0,0.15)]">
    <CardContent className="space-y-5 p-7 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning">
        <Clock className="h-6 w-6" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-title3 font-semibold tracking-tight text-foreground">Clock in first</h2>
        <p className="text-footnote leading-snug text-muted-foreground">
          You need to clock in before scanning area or task QR codes. Tap the button below to clock in, then come back
          to scan.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          onClick={onGoToClockIn}
          className="h-11 w-full rounded-full bg-primary text-subheadline font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
        >
          Go to Clock In
        </Button>
        <Button
          variant="ghost"
          onClick={onCancel}
          className="h-10 w-full rounded-full text-footnote font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Cancel
        </Button>
      </div>
    </CardContent>
  </Card>
)
