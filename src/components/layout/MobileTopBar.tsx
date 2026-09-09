import React from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Menu, User } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSidebar } from '@/components/ui/sidebar'

interface MobileTopBarProps {
  title: string
  userName: string
  userTypeLabel: string
  onSignOut: () => void
}

/**
 * Phone-only header. Before this existed the sidebar collapsed into a drawer
 * with nothing anywhere on screen to open it, which left mobile admins stuck
 * on whichever page they happened to land on.
 */
export const MobileTopBar: React.FC<MobileTopBarProps> = ({
  title,
  userName,
  userTypeLabel,
  onSignOut,
}) => {
  const navigate = useNavigate()
  const { setOpenMobile } = useSidebar()

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-gray-100 bg-white/90 px-2 backdrop-blur-md md:hidden">
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="Open menu"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-gray-600 transition active:bg-gray-100"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-gray-900">
        {title}
      </h1>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-gradient-to-r from-red-600 to-red-700 text-sm font-semibold text-white">
                {userName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-56 rounded-2xl border-0 shadow-xl">
          <DropdownMenuLabel className="pb-1">
            <div className="truncate text-sm font-semibold text-gray-900">{userName}</div>
            <div className="truncate text-xs font-normal text-gray-500">{userTypeLabel}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/profile')} className="gap-2 rounded-xl">
            <User className="h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onSignOut}
            className="gap-2 rounded-xl text-red-600 focus:text-red-600"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
