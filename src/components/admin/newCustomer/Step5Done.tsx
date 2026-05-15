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
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>

        <div className="space-y-2">
          <p className="text-lg text-gray-700">
            <strong className="text-gray-900">{state.customerName}</strong> is ready to go.
          </p>
          <p className="text-sm text-gray-500">
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
            className="rounded-full border-gray-200 py-5 text-base text-gray-700 hover:bg-gray-50"
          >
            View QR Library
          </Button>
          <Button
            onClick={onFinish}
            className="rounded-full bg-[#00339B] py-5 text-base text-white hover:bg-[#002d7a]"
          >
            Add another client
          </Button>
        </div>
      </div>
    </WizardShell>
  )
}
