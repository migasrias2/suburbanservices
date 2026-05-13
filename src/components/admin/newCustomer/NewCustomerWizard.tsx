import React, { useEffect, useState } from 'react'
import { Step1Basics } from './Step1Basics'
import { Step2Managers } from './Step2Managers'
import { Step3Areas } from './Step3Areas'
import { Step4QRs } from './Step4QRs'
import { Step5Done } from './Step5Done'
import {
  INITIAL_STATE,
  loadWizardState,
  saveWizardState,
  clearWizardState,
  type WizardState,
} from './types'
import { invalidateManagerScopes, hydrateManagerScopes } from '@/lib/managerScope'

const TOTAL_STEPS = 5

export const NewCustomerWizard: React.FC = () => {
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    setState(loadWizardState())
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (isHydrated) saveWizardState(state)
  }, [state, isHydrated])

  const update = (patch: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...patch }))

  const go = (step: WizardState['step']) => setState((prev) => ({ ...prev, step }))

  const handleFinish = () => {
    invalidateManagerScopes()
    hydrateManagerScopes()
    clearWizardState()
    setState(INITIAL_STATE)
  }

  if (!isHydrated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-900 border-t-transparent" />
      </div>
    )
  }

  switch (state.step) {
    case 1:
      return (
        <Step1Basics
          state={state}
          totalSteps={TOTAL_STEPS}
          onUpdate={update}
          onNext={() => go(2)}
        />
      )
    case 2:
      return (
        <Step2Managers
          state={state}
          totalSteps={TOTAL_STEPS}
          onUpdate={update}
          onBack={() => go(1)}
          onNext={() => go(3)}
        />
      )
    case 3:
      return (
        <Step3Areas
          state={state}
          totalSteps={TOTAL_STEPS}
          onUpdate={update}
          onBack={() => go(2)}
          onNext={() => go(4)}
        />
      )
    case 4:
      return (
        <Step4QRs
          state={state}
          totalSteps={TOTAL_STEPS}
          onUpdate={update}
          onBack={() => go(3)}
          onNext={() => go(5)}
        />
      )
    case 5:
      return (
        <Step5Done
          state={state}
          totalSteps={TOTAL_STEPS}
          onFinish={handleFinish}
        />
      )
    default:
      return null
  }
}
