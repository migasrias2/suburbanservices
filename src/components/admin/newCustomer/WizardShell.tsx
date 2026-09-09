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
      <div className="mb-6 flex items-center justify-center gap-2 sm:mb-10">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const idx = i + 1
          const filled = idx <= step
          return (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                filled ? 'w-8 bg-primary' : 'w-2 bg-secondary'
              }`}
            />
          )
        })}
      </div>

      <div className="rounded-3xl bg-card/80 p-5 shadow-sm backdrop-blur sm:p-8 md:p-12">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm text-muted-foreground sm:mt-3 sm:text-base md:text-lg">{subtitle}</p>
          )}
        </div>

        <div key={step} className="page-fade">{children}</div>

        {(!hideBack || !hideNext) && (
          <div className="mt-8 flex items-center justify-between gap-3 sm:mt-12">
            {!hideBack && onBack ? (
              <Button
                variant="ghost"
                onClick={onBack}
                disabled={isWorking}
                className="rounded-full px-5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            ) : <span />}

            {!hideNext && onNext && (
              <Button
                onClick={onNext}
                disabled={nextDisabled || isWorking}
                className="h-12 rounded-full bg-primary px-6 text-base font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:bg-secondary disabled:text-muted-foreground sm:px-7"
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
