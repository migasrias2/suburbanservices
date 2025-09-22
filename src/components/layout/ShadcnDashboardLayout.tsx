import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, QrCode, FileText, Settings, LogOut, User, Clock } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ShadcnDashboardLayoutProps {
  children: React.ReactNode
  userType: 'cleaner' | 'manager' | 'admin'
  userName: string
}

export const ShadcnDashboardLayout: React.FC<ShadcnDashboardLayoutProps> = ({
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
    { icon: Clock, label: 'Clock In', path: '/clock-in' },
    { icon: QrCode, label: 'Scanner', path: '/scanner' },
    { icon: FileText, label: 'History', path: '/history' },
  ]

  const isActive = (path: string) => location.pathname === path

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex w-full">
        <Sidebar variant="floating" className="border-sidebar-border">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-3">
              <img 
                src="/suburban_services_logo-scaled.webp" 
                alt="Suburban Services" 
                className="h-8 w-auto"
              />
              <div className="flex flex-col text-left">
                <span className="text-sm font-semibold text-sidebar-foreground">
                  Suburban Services
                </span>
                <span className="text-xs text-sidebar-foreground/70 capitalize">
                  {userType} Portal
                </span>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {cleanerMenuItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.path)}
                          tooltip={item.label}
                        >
                          <button
                            onClick={() => navigate(item.path)}
                            className="flex items-center gap-3 w-full"
                          >
                            <Icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="p-4">
            <SidebarMenu>
              {/* Profile */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive('/profile')}
                  tooltip="Profile"
                >
                  <button
                    onClick={() => navigate('/profile')}
                    className="flex items-center gap-3 w-full"
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                        {userName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col text-left min-w-0">
                      <span className="text-sm font-medium truncate">{userName}</span>
                      <span className="text-xs text-sidebar-foreground/70 capitalize">{userType}</span>
                    </div>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Logout */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Log out">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Log out</span>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="flex-1">
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="w-full max-w-7xl mx-auto">
              {children}
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
