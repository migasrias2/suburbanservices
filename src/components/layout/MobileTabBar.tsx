import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import type { NavItem } from './navigation'

interface MobileTabBarProps {
  tabs: NavItem[]
  /** Badge count for the assistance tab; 0 hides it. */
  badgeCount?: number
  badgePath?: string
}

/**
 * Phone-only bottom navigation. Four destinations plus a "More" button that
 * opens the full drawer — the drawer alone is too many taps for the pages
 * people move between constantly.
 */
export const MobileTabBar: React.FC<MobileTabBarProps> = ({ tabs, badgeCount = 0, badgePath }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { setOpenMobile } = useSidebar()

  const visible = tabs.slice(0, 4)

  return (
    <nav
      aria-label="Primary"
      className="glass-thin fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex items-stretch">
        {visible.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.path
          const showBadge = badgePath === item.path && badgeCount > 0
          return (
            <button
              key={item.path}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (location.pathname !== item.path) navigate(item.path)
              }}
              className={cn(
                'relative flex min-h-[49px] min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 transition active:bg-accent',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} />
                {showBadge && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-caption2 font-semibold text-destructive-foreground">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate px-0.5 text-caption2 font-medium tracking-tight">
                {item.shortLabel ?? item.label}
              </span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="flex min-h-[49px] min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-muted-foreground transition active:bg-accent"
        >
          <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.9} />
          <span className="text-caption2 font-medium tracking-tight">More</span>
        </button>
      </div>
    </nav>
  )
}
