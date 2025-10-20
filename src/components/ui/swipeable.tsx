import React, { useRef, useState } from 'react'

interface SwipeableProps {
  children: React.ReactNode
  action:
    | {
        icon: React.ReactNode
        label?: string
        onClick: () => void
        className?: string
      }
  className?: string
}

export const Swipeable: React.FC<SwipeableProps> = ({ children, action, className }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const startX = useRef<number | null>(null)
  const startOffset = useRef<number>(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const [blockClicksUntil, setBlockClicksUntil] = useState<number>(0)

  const reset = () => setOffset(0)

  const onStart = (x: number) => {
    startX.current = x
    startOffset.current = offset
  }
  const onMove = (x: number) => {
    if (startX.current == null) return
    const dx = x - startX.current
    if (!isSwiping && Math.abs(dx) > 6) setIsSwiping(true)
    // Allow dragging from current position using the startOffset baseline
    const raw = startOffset.current + dx
    const next = Math.max(-96, Math.min(0, raw))
    setOffset(next)
  }
  const onEnd = () => {
    if (offset < -48) {
      setOffset(-96)
    } else {
      setOffset(0)
    }
    startX.current = null
    if (isSwiping) {
      setBlockClicksUntil(Date.now() + 250)
    }
    setIsSwiping(false)
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className || ''}`}>
      <div
        className="absolute inset-y-0 right-0 w-24 flex items-center justify-center bg-rose-600 text-white rounded-l-3xl"
        style={{ transform: `translateX(${Math.min(0, 96 + offset)}px)` }}
      >
        <button
          type="button"
          onClick={() => {
            reset()
            action.onClick()
          }}
          className={`flex h-full w-full items-center justify-center gap-2 font-medium ${action.className || ''}`}
          aria-label={action.label || 'Delete'}
        >
          {action.icon}
          {action.label ? <span className="text-xs">{action.label}</span> : null}
        </button>
      </div>
      <div
        className="relative will-change-transform"
        style={{ transform: `translateX(${offset}px)`, transition: startX.current == null ? 'transform 180ms ease' : undefined }}
        onClickCapture={(e) => {
          if (isSwiping || Date.now() < blockClicksUntil || offset !== 0) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onMouseDown={(e) => onStart(e.clientX)}
        onMouseMove={(e) => startX.current != null && onMove(e.clientX)}
        onMouseUp={onEnd}
        onMouseLeave={onEnd}
        onTouchStart={(e) => onStart(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={onEnd}
      >
        {children}
      </div>
    </div>
  )
}


