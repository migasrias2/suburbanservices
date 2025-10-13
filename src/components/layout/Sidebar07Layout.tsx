import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Clock, 
  MessageCircle, 
  FileText, 
  Settings, 
  LogOut, 
  ChevronDown,
  Building2,
  User,
  BarChart3,
  Users,
  QrCode
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
  userType: 'cleaner' | 'manager' | 'admin'
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

  const handleLogout = () => {
    localStorage.removeItem('userType')
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
    navigate('/login')
  }

  const cleanerMenuItems = [
    { icon: Clock, label: 'Clock In', path: '/clock-in' },
  ]

  const managerMenuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/manager-dashboard' },
    { icon: Clock, label: 'Recent Activity', path: '/manager-activity' },
  ]

  const adminMenuItems = [
    { icon: QrCode, label: 'QR Library', path: '/qr-library' },
    { icon: Users, label: 'User Management', path: '/admin-dashboard' },
  ]

  const getMenuItems = () => {
    switch (userType) {
      case 'cleaner':
        return cleanerMenuItems
      case 'manager':
        return managerMenuItems
      case 'admin':
        return adminMenuItems
      default:
        return cleanerMenuItems
    }
  }

  const menuItems = getMenuItems()

  const isActive = (path: string) => location.pathname === path

  const getHeaderTitle = () => {
    if (userType === 'admin') {
      if (location.pathname === '/qr-library') return 'QR Library'
      if (location.pathname === '/admin-dashboard') return 'User Management'
      return 'Admin'
    }
    return userType === 'cleaner' ? 'Cleaner Dashboard' : 'Manager Dashboard'
  }

  return (
    <SidebarProvider defaultOpen={!isMobile}>
      <div className="min-h-screen bg-gray-50 flex w-full">
        <Sidebar variant="sidebar" className="bg-white border-0">
          {/* Company Header */}
          <SidebarHeader className="bg-white border-0">
            <div className="flex items-center justify-center px-4 py-4">
              <img 
                src="/suburban_services_logo-scaled.webp" 
                alt="Suburban Services" 
                className="h-16 w-16 object-contain sm:h-20 sm:w-20"
              />
            </div>
          </SidebarHeader>

          <SidebarContent className="px-2">
            {/* Navigation Menu */}
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-3">
                  {menuItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.path)
                    return (
                      <React.Fragment key={item.label}>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            asChild
                            className={`rounded-full transition-all duration-200 h-11 text-sm ${
                              active
                                ? 'bg-[#00339B] text-white shadow-lg'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                            }`}
                          >
                            <button
                              onClick={() => navigate(item.path)}
                              className="flex items-center gap-3 w-full px-4 py-2"
                            >
                              <Icon className="h-5 w-5" />
                              <span className="font-medium">{item.label}</span>
                            </button>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </React.Fragment>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
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
                        <span className="truncate text-xs text-gray-500 capitalize">
                          {userType}
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

        <SidebarInset className="flex-1">
          {/* Top Header Bar */}
          <header className={`flex shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 bg-white ${
            isMobile ? 'h-14' : 'h-16'
          }`}>
            <div className="flex items-center gap-3 px-3 sm:px-4">
              <SidebarTrigger className="-ml-1 text-gray-600 hover:text-gray-900" />
            </div>
          </header>

          {/* Main Content with subtle page fade animation */}
          <div className="flex flex-1 flex-col gap-4 px-4 pb-6 pt-2 sm:p-6 sm:pt-0">
            <div className="w-full max-w-7xl mx-auto py-4 sm:py-6">
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
