import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  step?: 1 | 2 | 3
  onBack?: () => void
  onContinue?: () => void
  canContinue?: boolean
  showControls?: boolean
}

const ProgressIndicator = ({ step: controlledStep, onBack, onContinue, canContinue = true, showControls = true }: Props) => {
  const [uncontrolledStep, setUncontrolledStep] = useState<1 | 2 | 3>(1)
  const [isExpanded, setIsExpanded] = useState(true)
  const step = (controlledStep ?? uncontrolledStep) as 1 | 2 | 3

  const handleContinue = () => {
    if (onContinue) return onContinue()
    if (uncontrolledStep < 3) {
      setUncontrolledStep((uncontrolledStep + 1) as 1 | 2 | 3)
      setIsExpanded(false)
    }
  }

  const handleBack = () => {
    if (onBack) return onBack()
    if (uncontrolledStep === 2) setIsExpanded(true)
    if (uncontrolledStep > 1) setUncontrolledStep((uncontrolledStep - 1) as 1 | 2 | 3)
  }

  return (
    <div className="flex flex-col items-center justify-center gap-8">
      <div className="flex items-center gap-6 relative">
        {[1, 2, 3].map((dot) => (
          <div
            key={dot}
            className={cn(
              'w-2 h-2 rounded-full relative z-10',
              dot <= step ? 'bg-white' : 'bg-gray-300'
            )}
          />
        ))}

        {/* Brand progress overlay */}
        <motion.div
          initial={{ width: '12px', height: '24px', x: 0 }}
          animate={{
            width: step === 1 ? '24px' : step === 2 ? '60px' : '96px',
            x: 0,
          }}
          className="absolute -left-[8px] -top-[8px] -translate-y-1/2 h-3 rounded-full"
          style={{ backgroundColor: '#00339B' }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 20,
            mass: 0.8,
            bounce: 0.25,
            duration: 0.6,
          }}
        />
      </div>

      {showControls && (
        <div className="w-full max-w-sm">
          <motion.div
            className="flex items-center gap-1"
            animate={{ justifyContent: isExpanded ? 'stretch' : 'space-between' }}
          >
            {!isExpanded && (
              <motion.button
                initial={{ opacity: 0, width: 0, scale: 0.8 }}
                animate={{ opacity: 1, width: '64px', scale: 1 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 15,
                  mass: 0.8,
                  bounce: 0.25,
                  duration: 0.6,
                  opacity: { duration: 0.2 },
                }}
                onClick={handleBack}
                className="px-4 py-3 text-black flex items-center justify-center bg-gray-100 font-semibold rounded-full hover:bg-gray-50 hover:border transition-colors flex-1 w-16 text-sm"
              >
                Back
              </motion.button>
            )}
            <motion.button
              onClick={handleContinue}
              animate={{ flex: isExpanded ? 1 : 'inherit' }}
              disabled={!canContinue}
              className={cn(
                'px-4 py-3 rounded-full text-white transition-colors flex-1 w-56 disabled:opacity-50 disabled:cursor-not-allowed',
                !isExpanded && 'w-44'
              )}
              style={{ backgroundColor: '#00339B' }}
            >
              <div className="flex items-center font-[600] justify-center gap-2 text-sm">
                {step === 3 && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 15,
                      mass: 0.5,
                      bounce: 0.4,
                    }}
                  >
                    <CircleCheck size={16} />
                  </motion.div>
                )}
                {step === 3 ? 'Finish' : 'Continue'}
              </div>
            </motion.button>
          </motion.div>
        </div>
      )}
    </div>
  )
}

export default ProgressIndicator


