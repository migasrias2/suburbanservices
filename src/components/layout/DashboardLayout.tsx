import React, { useState } from 'react'
import { Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Button } from '../ui/button'

interface DashboardLayoutProps {
  children: React.ReactNode
  userType: 'cleaner' | 'manager' | 'admin'
  userName: string
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  userType,
  userName
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Mobile header */}
      <div className="lg:hidden bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="rounded-full p-2"
            >
              <Menu className="h-6 w-6" />
            </Button>
            <img 
              src="/suburban_services_logo-scaled.webp" 
              alt="Suburban Services" 
              className="h-8 w-auto"
            />
          </div>
          <div className="text-sm font-medium text-gray-700 capitalize">
            {userType} Portal
          </div>
        </div>
      </div>

      {/* Desktop Sidebar Toggle Button */}
      <div className="hidden lg:block fixed top-4 left-4 z-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="rounded-full p-2 bg-white/80 backdrop-blur-sm shadow-lg hover:bg-white/90"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <PanelLeftClose className="h-5 w-5" />
          )}
        </Button>
      </div>

      <div className="flex min-h-screen">
        {/* Desktop Sidebar - Only show on desktop when not collapsed */}
        {!sidebarCollapsed && (
          <div className="hidden lg:block lg:w-80 lg:flex-shrink-0">
            <div className="fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-40">
              <Sidebar
                isOpen={true}
                onClose={() => {}}
                userType={userType}
                userName={userName}
              />
            </div>
          </div>
        )}

        {/* Mobile Sidebar - Only show on mobile when open */}
        <div className="lg:hidden">
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            userType={userType}
            userName={userName}
          />
        </div>

        {/* Main Content */}
        <div className={`flex-1 w-full transition-all duration-300 ${
          sidebarCollapsed ? 'lg:ml-0' : 'lg:ml-80'
        }`}>
          <div className="flex justify-center">
            <div className="w-full max-w-7xl p-4 lg:p-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
