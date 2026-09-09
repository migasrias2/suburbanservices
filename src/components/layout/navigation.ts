import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  Clock,
  Home,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  QrCode,
  UserPlus,
  Users,
} from 'lucide-react'

export type UserType = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

export interface NavItem {
  icon: LucideIcon
  /** Sidebar wording. */
  label: string
  /** Bottom bar wording — clipped to ~9 characters so it fits a tab. */
  shortLabel?: string
  path: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export interface Navigation {
  /** Grouped menu shown in the sidebar (desktop) and the mobile drawer. */
  sections: NavSection[]
  /**
   * Destinations promoted to the mobile bottom bar. Capped at four so the
   * fifth slot can always be the "More" button that opens the full menu —
   * five targets is the most a thumb can hit reliably on a 360px screen.
   */
  tabs: NavItem[]
}

export const ASSIST_PATH = '/cleaner-assistance'

const CLEANER_ITEMS = {
  today: { icon: Home, label: 'Today', path: '/cleaner-dashboard' },
  clockIn: { icon: Clock, label: 'Clock In', shortLabel: 'Clock', path: '/clock-in' },
  schedule: { icon: CalendarDays, label: 'My Schedule', shortLabel: 'Shifts', path: '/my-schedule' },
  assist: { icon: Camera, label: 'Assistance', shortLabel: 'Assist', path: ASSIST_PATH },
} satisfies Record<string, NavItem>

const MANAGER_ITEMS = {
  dashboard: { icon: BarChart3, label: 'Dashboard', path: '/manager-dashboard' },
  activity: { icon: Clock, label: 'Recent Activity', shortLabel: 'Activity', path: '/manager-activity' },
  analytics: { icon: BarChart3, label: 'Analytics', shortLabel: 'Stats', path: '/analytics' },
} satisfies Record<string, NavItem>

const OPS_ITEMS = {
  dashboard: { icon: BarChart3, label: 'Dashboard', path: '/ops-dashboard' },
  clockIn: { icon: Clock, label: 'Clock In', shortLabel: 'Clock', path: '/clock-in' },
  calendar: { icon: CalendarDays, label: 'Calendar', path: '/ops-calendar' },
  analytics: { icon: BarChart3, label: 'Analytics', shortLabel: 'Stats', path: '/analytics' },
} satisfies Record<string, NavItem>

const ADMIN_ITEMS = {
  dashboard: { icon: LayoutDashboard, label: 'Dashboard', shortLabel: 'Live', path: '/admin/dashboard' },
  users: { icon: Users, label: 'Users', path: '/admin/users' },
  newCustomer: { icon: UserPlus, label: 'New Client', shortLabel: 'Client', path: '/admin/new-customer' },
  calendar: { icon: CalendarDays, label: 'Calendar', path: '/admin-weekly-schedule' },
  analytics: { icon: BarChart3, label: 'Analytics', shortLabel: 'Stats', path: '/analytics' },
  presets: { icon: Layers, label: 'Area Presets', path: '/admin/presets' },
  areaTasks: { icon: Building2, label: 'Areas & Tasks', path: '/area-tasks' },
  qrLibrary: { icon: Library, label: 'QR Library', path: '/qr-library' },
  qrGenerator: { icon: QrCode, label: 'QR Generator', path: '/qr-generator' },
  dashboardAccess: { icon: KeyRound, label: 'Dashboard Access', path: '/admin/dashboard-access' },
} satisfies Record<string, NavItem>

/**
 * Managers whose account predates the analytics rollout and who were never
 * meant to see it. Matched on display name because that is the only identity
 * the layout is handed.
 */
const ANALYTICS_DENYLIST = new Set(['James Manager', 'James', 'James Spenceley'])

const cleanerNavigation = (): Navigation => {
  const items = [CLEANER_ITEMS.today, CLEANER_ITEMS.clockIn, CLEANER_ITEMS.schedule, CLEANER_ITEMS.assist]
  return {
    sections: [{ title: 'Daily Tools', items }],
    tabs: items,
  }
}

const managerNavigation = (userName: string): Navigation => {
  const performance = [MANAGER_ITEMS.activity, MANAGER_ITEMS.analytics].filter(
    (item) => !(item.path === '/analytics' && ANALYTICS_DENYLIST.has(userName)),
  )
  return {
    sections: [
      { title: 'Overview', items: [MANAGER_ITEMS.dashboard] },
      { title: 'Performance', items: performance },
    ],
    tabs: [MANAGER_ITEMS.dashboard, ...performance],
  }
}

const opsNavigation = (): Navigation => ({
  sections: [
    { title: 'Overview', items: [OPS_ITEMS.dashboard] },
    { title: 'Site Visits', items: [OPS_ITEMS.clockIn, OPS_ITEMS.calendar] },
    { title: 'Insights', items: [OPS_ITEMS.analytics] },
  ],
  tabs: [OPS_ITEMS.dashboard, OPS_ITEMS.clockIn, OPS_ITEMS.calendar, OPS_ITEMS.analytics],
})

const adminNavigation = (): Navigation => ({
  sections: [
    {
      title: 'Main',
      items: [
        ADMIN_ITEMS.dashboard,
        ADMIN_ITEMS.users,
        ADMIN_ITEMS.newCustomer,
        ADMIN_ITEMS.calendar,
        ADMIN_ITEMS.analytics,
      ],
    },
    {
      title: 'Tools',
      items: [
        ADMIN_ITEMS.presets,
        ADMIN_ITEMS.areaTasks,
        ADMIN_ITEMS.qrLibrary,
        ADMIN_ITEMS.qrGenerator,
        ADMIN_ITEMS.dashboardAccess,
      ],
    },
  ],
  // The four an admin reaches for from a phone: who is on site, the people
  // list, the week, and the numbers. Everything else lives behind "More".
  tabs: [ADMIN_ITEMS.dashboard, ADMIN_ITEMS.users, ADMIN_ITEMS.calendar, ADMIN_ITEMS.analytics],
})

export const getNavigation = (userType: UserType, userName: string): Navigation => {
  switch (userType) {
    case 'manager':
      return managerNavigation(userName)
    case 'ops_manager':
      return opsNavigation()
    case 'admin':
      return adminNavigation()
    case 'cleaner':
    default:
      return cleanerNavigation()
  }
}

export const formatUserTypeLabel = (userType: UserType): string => {
  switch (userType) {
    case 'ops_manager':
      return 'Ops Manager'
    case 'admin':
      return 'Admin'
    case 'manager':
      return 'Manager'
    case 'cleaner':
    default:
      return 'Cleaner'
  }
}
