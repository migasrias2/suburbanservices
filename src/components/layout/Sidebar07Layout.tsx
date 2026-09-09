import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, LogOut, User } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { useOpenAssistCount } from '@/hooks/useOpenAssistCount'
import { ClockOutReminderBanner } from './ClockOutReminderBanner'
import { MobileTopBar } from './MobileTopBar'
import { MobileTabBar } from './MobileTabBar'
import { ASSIST_PATH, formatUserTypeLabel, getNavigation, type UserType } from './navigation'
import { resolvePageTitle } from './pageTitle'

interface Sidebar07LayoutProps {
  children: React.ReactNode
  userType: UserType
  userName: string
}

export const Sidebar07Layout: React.FC<Sidebar07LayoutProps> = ({
  children,
  userType,
  userName,
}) => {
  const isMobile = useIsMobile()

  return (
    <SidebarProvider defaultOpen={!isMobile}>
      <LayoutShell userType={userType} userName={userName}>
        {children}
      </LayoutShell>
    </SidebarProvider>
  )
}

/**
 * Split from the exported component only so the mobile chrome can call
 * useSidebar() — the hook throws outside SidebarProvider.
 */
const LayoutShell: React.FC<Sidebar07LayoutProps> = ({ children, userType, userName }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const { setOpenMobile } = useSidebar()

  // Cleaners had no way of knowing a request had come in without opening the
  // page. Resolved at render time rather than baked into the menu config,
  // which is memoised and would capture a stale count.
  const openAssistCount = useOpenAssistCount(userType === 'cleaner')

  // Reads from storage rather than props: every cleaner page already routes
  // through this layout, so the banner follows them wherever they are.
  const cleanerId = typeof window !== 'undefined' ? localStorage.getItem('userId') ?? '' : ''

  const navigation = React.useMemo(() => getNavigation(userType, userName), [userType, userName])
  const userTypeLabel = formatUserTypeLabel(userType)
  const pageTitle = resolvePageTitle(location.pathname, userType)

  const handleLogout = React.useCallback(async () => {
    await signOut()
    navigate('/login')
  }, [navigate, signOut])

  const go = React.useCallback(
    (path: string) => {
      // The drawer is a Sheet, and Sheets do not close themselves when the
      // route under them changes — without this it stays over the new page.
      setOpenMobile(false)
      if (location.pathname !== path) navigate(path)
    },
    [location.pathname, navigate, setOpenMobile],
  )

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar variant="sidebar" className="bg-sidebar border-0">
        <SidebarHeader className="bg-sidebar border-0 px-4 pt-4 pb-2">
          <div className="flex flex-col items-center text-center">
            <img
              src="/suburban_services_logo-scaled.webp"
              alt="Suburban Services"
              className="h-16 w-16 object-contain sm:h-20 sm:w-20"
            />
          </div>
        </SidebarHeader>

        <SidebarContent className="px-4 py-1 space-y-4">
          {navigation.sections.map((section) => (
            <SidebarGroup key={section.title} className="p-0">
              <SidebarGroupLabel className="px-3 text-caption2 font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {section.title}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="mt-2 space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.path)
                    return (
                      <SidebarMenuItem key={item.path} className="relative">
                        <SidebarMenuButton
                          asChild
                          className={`group rounded-2xl transition-all duration-200 h-11 text-sm pl-5 pr-3 ${
                            active
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                              : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => go(item.path)}
                            className="flex w-full items-center gap-3 py-2"
                          >
                            <Icon
                              className={`h-5 w-5 transition-colors duration-200 ${
                                active
                                  ? 'text-sidebar-primary'
                                  : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'
                              }`}
                            />
                            <span className="font-medium tracking-tight">{item.label}</span>
                          </button>
                        </SidebarMenuButton>
                        {item.path === ASSIST_PATH && openAssistCount > 0 && (
                          <>
                            <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                              {openAssistCount > 9 ? '9+' : openAssistCount}
                            </SidebarMenuBadge>
                            {/* SidebarMenuBadge hides when the rail collapses to icons */}
                            <span className="absolute right-2 top-2 hidden h-2 w-2 rounded-full bg-destructive group-data-[collapsible=icon]:block" />
                          </>
                        )}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="bg-sidebar p-2 border-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="rounded-full text-sidebar-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent h-12"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                        {userName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold text-sidebar-foreground">{userName}</span>
                      <span className="truncate text-caption text-muted-foreground">{userTypeLabel}</span>
                    </div>
                    <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-3xl border-0 shadow-xl"
                  side="bottom"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuItem
                    onClick={() => go('/profile')}
                    className="gap-2 cursor-pointer rounded-full mx-2 my-1"
                  >
                    <User className="h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-4 my-2" />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="gap-2 cursor-pointer text-destructive focus:text-destructive rounded-full mx-2 my-1"
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

      <SidebarInset className="min-w-0 flex-1 bg-background">
        <MobileTopBar
          title={pageTitle}
          userName={userName}
          userTypeLabel={userTypeLabel}
          onSignOut={handleLogout}
        />

        {/* pb-24 clears the fixed tab bar; sm:pb-6 drops it back on desktop. */}
        <div className="flex flex-1 flex-col px-4 pb-24 pt-4 sm:p-6 sm:pt-6 md:pb-6">
          <div className="mx-auto w-full max-w-7xl py-2 sm:py-4">
            <ClockOutReminderBanner cleanerId={cleanerId} enabled={userType === 'cleaner'} />
            <div key={location.pathname} className="page-fade">
              {children}
            </div>
          </div>
        </div>

        <MobileTabBar
          tabs={navigation.tabs}
          badgeCount={userType === 'cleaner' ? openAssistCount : 0}
          badgePath={ASSIST_PATH}
        />
      </SidebarInset>
    </div>
  )
}
