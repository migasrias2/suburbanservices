import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Clock,
  LogOut,
  ChevronDown,
  Building2,
  User,
  BarChart3,
  Users,
  QrCode,
  Camera,
  Library,
  Activity,
  CalendarDays
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'

interface Sidebar07LayoutProps {
  children: React.ReactNode
  userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin'
  userName: string
}

export const Sidebar07Layout: React.FC<Sidebar07LayoutProps> = ({
  children,
  userType,
  userName
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()

  type MenuItem = {
    icon: LucideIcon
    label: string
    path: string
  }

  type MenuSection = {
    title: string
    items: MenuItem[]
  }

  const handleLogout = () => {
    localStorage.removeItem('userType')
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
    localStorage.removeItem('currentClockInData')
    localStorage.removeItem('currentClockInPhase')
    localStorage.removeItem('currentSiteName')
    localStorage.removeItem('recentClockOutAt')
    navigate('/login')
  }

  const cleanerMenuItems: MenuItem[] = [
    { icon: Clock, label: 'Clock In', path: '/clock-in' },
    { icon: Camera, label: 'Assistance', path: '/cleaner-assistance' },
  ]

  const managerMenuItems: MenuItem[] = [
    { icon: BarChart3, label: 'Dashboard', path: '/manager-dashboard' },
    { icon: Clock, label: 'Recent Activity', path: '/manager-activity' },
    { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  ]

  const opsManagerMenuItems: MenuItem[] = [
    { icon: BarChart3, label: 'Dashboard', path: '/ops-dashboard' },
    { icon: Clock, label: 'Clock In', path: '/clock-in' },
    { icon: CalendarDays, label: 'Calendar', path: '/ops-calendar' },
    { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  ]

  const adminMenuItems: MenuItem[] = [
    { icon: Library, label: 'QR Library', path: '/qr-library' },
    { icon: QrCode, label: 'QR Generator', path: '/qr-generator' },
    { icon: Building2, label: 'Areas & Tasks', path: '/area-tasks' },
    { icon: Users, label: 'User Management', path: '/admin-dashboard' },
    { icon: BarChart3, label: 'Analytics', path: '/analytics' },
    { icon: Clock, label: 'Calendar', path: '/admin-weekly-schedule' },
  ]

  const getMenuSections = React.useCallback((): MenuSection[] => {
    switch (userType) {
      case 'cleaner':
        return [
          {
            title: 'Daily Tools',
            items: cleanerMenuItems,
          },
        ]
      case 'manager':
        return [
          {
            title: 'Overview',
            items: [managerMenuItems[0]],
          },
          {
            title: 'Performance',
            items: managerMenuItems.slice(1),
          },
        ]
      case 'ops_manager':
        return [
          {
            title: 'Overview',
            items: [opsManagerMenuItems[0]],
          },
          {
            title: 'Site Visits',
            items: opsManagerMenuItems.slice(1, 3),
          },
          {
            title: 'Insights',
            items: opsManagerMenuItems.slice(3),
          },
        ]
      case 'admin':
        return [
          {
            title: 'QR Suite',
            items: adminMenuItems.slice(0, 2),
          },
          {
            title: 'Operations',
            items: adminMenuItems.slice(2, 4),
          },
          {
            title: 'Insights',
            items: adminMenuItems.slice(4),
          },
        ]
      default:
        return [
          {
            title: 'Daily Tools',
            items: cleanerMenuItems,
          },
        ]
    }
  }, [userType])

  const menuSections = React.useMemo(() => getMenuSections(), [getMenuSections])

  const isActive = (path: string) => location.pathname === path

  const getHeaderTitle = () => {
    if (userType === 'admin') {
      if (location.pathname === '/qr-library') return 'QR Library'
      if (location.pathname === '/qr-generator') return 'QR Generator'
      if (location.pathname === '/area-tasks') return 'Areas & Tasks'
      if (location.pathname === '/admin-dashboard') return 'User Management'
      if (location.pathname === '/admin-weekly-schedule') return 'Weekly Calendar'
      return 'Admin'
    }
    if (userType === 'ops_manager') {
      if (location.pathname === '/clock-in') return 'Ops Manager Clock In'
      if (location.pathname === '/manager-activity') return 'Site Activity'
      if (location.pathname === '/analytics') return 'Analytics'
      return 'Ops Manager Dashboard'
    }
    return userType === 'cleaner' ? 'Cleaner Dashboard' : 'Manager Dashboard'
  }

  const formatUserTypeLabel = React.useCallback(() => {
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
  }, [userType])

  const userTypeLabel = formatUserTypeLabel()

  return (
    <SidebarProvider defaultOpen={!isMobile}>
      <div className="min-h-screen bg-gray-50 flex w-full">
        <Sidebar variant="sidebar" className="bg-white border-0">
          {/* Company Header */}
          <SidebarHeader className="bg-white border-0 px-4 pt-6 pb-4">
            <div className="flex flex-col items-center text-center">
              <img
                src="/suburban_services_logo-scaled.webp"
                alt="Suburban Services"
                className="h-28 w-28 object-contain sm:h-32 sm:w-32"
              />
            </div>
          </SidebarHeader>

          <SidebarContent className="px-4 py-2 space-y-6">
            {/* Navigation Menu */}
            {menuSections.map((section) => (
              <SidebarGroup key={section.title} className="p-0">
                <SidebarGroupLabel className="px-3 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-gray-400">
                  {section.title}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="mt-3 space-y-2">
                    {section.items.map((item) => {
                      const Icon = item.icon
                      const active = isActive(item.path)
                      return (
                        <SidebarMenuItem key={item.path} className="relative">
                          <SidebarMenuButton
                            asChild
                            className={`group rounded-2xl transition-all duration-200 h-11 text-sm pl-6 pr-3 ${
                              active
                                ? 'bg-[#00339B]/5 text-[#00339B] font-semibold shadow-sm shadow-[#00339B]/10'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-[#00339B]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (location.pathname !== item.path) {
                                  navigate(item.path)
                                }
                              }}
                              className="flex items-center gap-3 w-full py-2"
                            >
                              <Icon
                                className={`h-5 w-5 transition-colors duration-200 ${
                                  active
                                    ? 'text-[#00339B]'
                                    : 'text-gray-400 group-hover:text-[#00339B]'
                                }`}
                              />
                              <span className="font-medium tracking-tight">
                                {item.label}
                              </span>
                            </button>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          {/* User Profile Footer */}
          <SidebarFooter className="bg-white p-2 border-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      className="rounded-full text-gray-700 hover:bg-gray-100 data-[state=open]:bg-gray-100 h-12"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-gradient-to-r from-red-600 to-red-700 text-white font-semibold">
                          {userName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-semibold text-gray-900">
                          {userName}
                        </span>
                        <span className="truncate text-xs text-gray-500">
                          {userTypeLabel}
                        </span>
                      </div>
                      <ChevronDown className="ml-auto h-4 w-4 text-gray-400" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-3xl border-0 shadow-xl"
                    side="bottom"
                    align="end"
                    sideOffset={4}
                  >
                    <DropdownMenuItem
                      onClick={() => navigate('/profile')}
                      className="gap-2 cursor-pointer rounded-full mx-2 my-1"
                    >
                      <User className="h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="mx-4 my-2" />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="gap-2 cursor-pointer text-red-600 focus:text-red-600 rounded-full mx-2 my-1"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="flex-1 bg-gray-50">
          {/* Main Content with subtle page fade animation */}
          <div className="flex flex-1 flex-col px-4 pb-6 pt-4 sm:p-6 sm:pt-6">
            <div className="w-full max-w-7xl mx-auto py-2 sm:py-4">
              <div className="page-fade-enter page-fade-enter-active">
                {children}
              </div>
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
