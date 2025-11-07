import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  QrCode, 
  BarChart3, 
  Users, 
  LogOut, 
  Home,
  Camera,
  FileText,
  Settings,
  X,
  Clock,
  CalendarDays
} from 'lucide-react'
import { Button } from '../ui/button'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin'
  userName: string
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, userType, userName }) => {
  const navigate = useNavigate()
  const location = useLocation()

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

  const cleanerMenuItems = [
    { icon: Clock, label: 'Clock In', path: '/clock-in' },
    { icon: QrCode, label: 'Scanner', path: '/scanner' },
    { icon: FileText, label: 'History', path: '/history' },
  ]

  const profileMenuItem = { icon: Settings, label: 'Profile', path: '/profile' }

  const managerMenuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/manager-dashboard' },
    { icon: Users, label: 'Live Tracking', path: '/manager-dashboard', section: 'overview' },
    { icon: QrCode, label: 'QR Generator', path: '/manager-dashboard', section: 'qr-generator' },
    { icon: FileText, label: 'Reports', path: '/manager-dashboard', section: 'reports' },
    { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  ]

  const opsManagerMenuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/ops-dashboard' },
    { icon: Clock, label: 'Clock In', path: '/clock-in' },
    { icon: CalendarDays, label: 'Calendar', path: '/ops-calendar' },
    { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  ]

  const menuItems = userType === 'cleaner'
    ? cleanerMenuItems
    : userType === 'ops_manager'
      ? opsManagerMenuItems
      : managerMenuItems

  const isActive = (path: string) => location.pathname === path

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        h-full w-80 bg-white flex flex-col
        lg:relative lg:shadow-none
        ${isOpen 
          ? 'fixed top-0 left-0 shadow-2xl z-50 transform translate-x-0' 
          : 'fixed top-0 left-0 shadow-2xl z-50 transform -translate-x-full lg:translate-x-0'}
        transition-transform duration-300 ease-in-out
      `}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <img 
              src="/suburban_services_logo-scaled.webp" 
              alt="Suburban Services" 
              className="h-10 w-auto"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="lg:hidden rounded-full p-2"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  onClick={() => {
                    navigate(item.path)
                    onClose()
                  }}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all duration-200
                    ${isActive(item.path)
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'
                    }
                  `}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 space-y-2">
          {/* Profile Button */}
          <button
            onClick={() => {
              navigate(profileMenuItem.path)
              onClose()
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all duration-200 text-gray-700 hover:bg-gray-50 hover:text-blue-600"
          >
            <Settings className="h-5 w-5" />
            <span className="font-medium">Profile</span>
          </button>
          
          {/* Logout Button */}
          <Button
            onClick={handleLogout}
            variant="ghost"
            className="w-full justify-start gap-3 px-4 py-3 rounded-2xl text-gray-700 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-5 w-5" />
            <span className="font-medium">Logout</span>
          </Button>
        </div>
      </div>
    </>
  )
}
