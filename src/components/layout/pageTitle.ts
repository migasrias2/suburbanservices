import type { UserType } from './navigation'

/**
 * Title for the mobile top bar. On a phone the sidebar is hidden behind a
 * drawer, so this bar is the only thing telling an admin which of ten
 * near-identical white pages they are looking at.
 */
const TITLES: Record<string, string> = {
  '/admin/dashboard': 'Live Dashboard',
  '/admin/users': 'Users',
  '/admin/new-customer': 'New Client',
  '/admin/presets': 'Area Presets',
  '/admin/dashboard-access': 'Dashboard Access',
  '/admin-weekly-schedule': 'Weekly Calendar',
  '/qr-library': 'QR Library',
  '/qr-generator': 'QR Generator',
  '/area-tasks': 'Areas & Tasks',
  '/analytics': 'Analytics',
  '/manager-activity': 'Site Activity',
  '/ops-calendar': 'Calendar',
  '/profile': 'Profile',
  '/history': 'History',
  '/chat': 'Messages',
  '/my-schedule': 'My Schedule',
  '/cleaner-assistance': 'Assistance',
  '/scanner': 'Scanner',
}

const FALLBACK: Record<UserType, string> = {
  admin: 'Admin',
  ops_manager: 'Ops Manager',
  manager: 'Manager Dashboard',
  cleaner: 'Today',
}

export const resolvePageTitle = (pathname: string, userType: UserType): string => {
  const known = TITLES[pathname]
  if (known) return known

  if (pathname === '/clock-in') {
    return userType === 'ops_manager' ? 'Ops Manager Clock In' : 'Clock In'
  }
  if (pathname === '/cleaner-dashboard') return 'Today'
  if (pathname === '/manager-dashboard' || pathname === '/ops-dashboard') {
    return FALLBACK[userType]
  }

  return FALLBACK[userType]
}
