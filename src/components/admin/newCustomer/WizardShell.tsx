import React from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface WizardShellProps {
  step: number
  totalSteps: number
  title: string
  subtitle?: string
  children: React.ReactNode
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  isWorking?: boolean
  hideBack?: boolean
  hideNext?: boolean
}

export const WizardShell: React.FC<WizardShellProps> = ({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled,
  isWorking,
  hideBack,
  hideNext,
}) => {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-10 flex items-center justify-center gap-2">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const idx = i + 1
          const filled = idx <= step
          return (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                filled ? 'w-8 bg-[#00339B]' : 'w-2 bg-gray-300'
              }`}
            />
          )
        })}
      </div>

      <div className="rounded-3xl bg-white/80 p-8 shadow-sm backdrop-blur sm:p-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-base text-gray-500 sm:text-lg">{subtitle}</p>
          )}
        </div>

        <div key={step} className="page-fade">{children}</div>

        {(!hideBack || !hideNext) && (
          <div className="mt-12 flex items-center justify-between">
            {!hideBack && onBack ? (
              <Button
                variant="ghost"
                onClick={onBack}
                disabled={isWorking}
                className="rounded-full px-5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            ) : <span />}

            {!hideNext && onNext && (
              <Button
                onClick={onNext}
                disabled={nextDisabled || isWorking}
                className="rounded-full bg-[#00339B] px-7 py-5 text-base font-medium text-white shadow-sm transition hover:bg-[#002d7a] disabled:bg-gray-200 disabled:text-gray-400"
              >
                {isWorking ? 'Working…' : nextLabel}
                {!isWorking && <ChevronRight className="ml-1 h-4 w-4" />}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
