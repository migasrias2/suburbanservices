import React from 'react'

type AnalyticsChartCardProps = {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

export const AnalyticsChartCard: React.FC<AnalyticsChartCardProps> = ({
  title,
  description,
  action,
  children,
  footer,
}) => (
  <div className="rounded-[32px] border border-gray-100 bg-white p-6 shadow-[0_18px_45px_rgba(15,35,95,0.08)]">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 px-2">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {description ? <p className="text-sm text-gray-500">{description}</p> : null}
      </div>
      {action}
    </div>
    <div className="rounded-[28px] bg-gradient-to-b from-white via-white to-blue-50/30 p-4">
      <div className="rounded-[24px] bg-white p-4 shadow-[inset_0_1px_6px_rgba(15,35,95,0.08)]">
        {children}
      </div>
    </div>
    {footer ? <div className="mt-5 px-2 text-sm text-gray-600">{footer}</div> : null}
  </div>
)
