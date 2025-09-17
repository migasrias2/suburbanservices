import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Home, 
  QrCode, 
  FileText, 
  Settings, 
  LogOut, 
  ChevronDown,
  Building2,
  User,
  BarChart3,
  Users
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
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

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

  const handleLogout = () => {
    localStorage.removeItem('userType')
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
    navigate('/login')
  }

  const cleanerMenuItems = [
    { icon: Home, label: 'Clock In', path: '/clock-in' },
    { icon: QrCode, label: 'Chat', path: '/chat' },
  ]

  const managerMenuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/manager-dashboard' },
    { icon: Users, label: 'Live Tracking', path: '/manager-dashboard' },
    { icon: QrCode, label: 'QR Generator', path: '/manager-dashboard' },
  ]

  const adminMenuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/admin-dashboard' },
    { icon: QrCode, label: 'QR Library', path: '/qr-library' },
    { icon: Users, label: 'User Management', path: '/admin-dashboard' },
    { icon: Settings, label: 'System Settings', path: '/admin-dashboard' },
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

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-gray-50 flex w-full">
        <Sidebar variant="sidebar" className="bg-white">
          {/* Company Header */}
          <SidebarHeader className="bg-sidebar">
            <div className="flex items-center justify-center px-4 py-4">
              <img 
                src="/suburban_services_logo-scaled.webp" 
                alt="Suburban Services" 
                className="h-24 w-24 object-contain"
              />
            </div>
          </SidebarHeader>

          <SidebarContent className="px-2">
            {/* Navigation Menu */}
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {menuItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.path)
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          style={active ? { backgroundColor: '#00339B', color: '#ffffff' } : undefined}
                          className={`
                            rounded-xl transition-all duration-200 h-12
                            ${active 
                              ? 'shadow-sm' 
                              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                            }
                          `}
                        >
                          <button
                            onClick={() => navigate(item.path)}
                            className="flex items-center gap-3 w-full px-4 py-3"
                          >
                            <Icon className="h-5 w-5" />
                            <span className="font-medium">{item.label}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          {/* User Profile Footer */}
          <SidebarFooter className="bg-sidebar p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      className="rounded-xl text-gray-700 hover:bg-gray-100 data-[state=open]:bg-gray-100 h-14"
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
                    className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-2xl border-0 shadow-xl"
                    side="bottom"
                    align="end"
                    sideOffset={4}
                  >
                    <DropdownMenuItem
                      onClick={() => navigate('/profile')}
                      className="gap-2 cursor-pointer rounded-lg"
                    >
                      <User className="h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="gap-2 cursor-pointer text-red-600 focus:text-red-600 rounded-lg"
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
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 bg-white/80 backdrop-blur-sm border-b border-gray-200">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1 text-gray-600 hover:text-gray-900" />
              <div className="h-4 w-px bg-gray-300" />
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5" style={{ color: '#00339B' }} />
                <span className="font-semibold text-gray-900">
                  {userType === 'cleaner' ? 'Cleaner Dashboard' : 
                   userType === 'manager' ? 'Manager Dashboard' : 'Admin Dashboard'}
                </span>
              </div>
            </div>
          </header>

          {/* Main Content with subtle page fade animation */}
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="w-full max-w-7xl mx-auto py-6">
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
