import React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: React.ReactNode
  /** Buttons for this page. Stacked full-width under the title on phones. */
  actions?: React.ReactNode
  className?: string
}

/**
 * The title block every admin page opens with.
 *
 * Each page used to hand-roll `flex items-start justify-between`, which on a
 * phone squeezed a 30px heading and a button into 360px and wrapped the
 * heading down the left edge. Here the two stack until there is room.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  className,
}) => (
  // On phones the title and description are hidden, so a header with no
  // actions has nothing to show and should not reserve space either.
  <div className={cn('md:mb-8', actions && 'mb-4', className)}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {/* Hidden on phones — the mobile top bar already names the page. */}
        <h1 className="hidden text-3xl font-semibold tracking-tight text-gray-900 md:block lg:text-4xl">
          {title}
        </h1>
        {/* Also hidden on phones: with the title gone this is a lone paragraph
            of boilerplate pushing the actual content below the fold. */}
        {description ? (
          <p className="hidden text-gray-500 md:mt-2 md:block md:text-base">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      ) : null}
    </div>
  </div>
)

/**
 * A row of filter pills. On a phone it scrolls sideways instead of wrapping
 * into four stacked rows that push the actual content below the fold.
 */
export const FilterStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div
    className={cn(
      '-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      'sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0',
      className,
    )}
  >
    {children}
  </div>
)
