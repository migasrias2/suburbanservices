import React from 'react'
import { useNavigate } from 'react-router-dom'
import { WizardShell } from './WizardShell'
import { Button } from '@/components/ui/button'
import { CheckCircle2 } from 'lucide-react'
import type { WizardState } from './types'

interface Step5Props {
  state: WizardState
  totalSteps: number
  onFinish: () => void
}

export const Step5Done: React.FC<Step5Props> = ({ state, totalSteps, onFinish }) => {
  const navigate = useNavigate()

  return (
    <WizardShell
      step={5}
      totalSteps={totalSteps}
      title="All set"
      hideBack
      hideNext
    >
      <div className="space-y-8 text-center">
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>

        <div className="space-y-2">
          <p className="text-lg text-foreground">
            <strong className="text-foreground">{state.customerName}</strong> is ready to go.
          </p>
          <p className="text-sm text-muted-foreground">
            {state.selectedManagerIds.length} manager{state.selectedManagerIds.length === 1 ? '' : 's'} assigned ·{' '}
            {state.areas.length} area{state.areas.length === 1 ? '' : 's'} ·{' '}
            {state.qrPack.length} QR code{state.qrPack.length === 1 ? '' : 's'} generated
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            onClick={() => {
              onFinish()
              navigate('/qr-library')
            }}
            variant="outline"
            className="rounded-full border-border py-5 text-base text-foreground hover:bg-muted"
          >
            View QR Library
          </Button>
          <Button
            onClick={onFinish}
            className="rounded-full bg-primary py-5 text-base text-primary-foreground hover:bg-primary/90"
          >
            Add another client
          </Button>
        </div>
      </div>
    </WizardShell>
  )
}
