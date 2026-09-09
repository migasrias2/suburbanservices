import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Users, UserCheck, Shield, type LucideIcon } from 'lucide-react'
import { PhoneInput } from '../components/ui/phone-input'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { useAuth } from '../contexts/AuthContext'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type AuthTab = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

const AUTH_TABS: { value: AuthTab; label: string; Icon: LucideIcon | null }[] = [
  { value: 'cleaner', label: 'Cleaner', Icon: Users },
  { value: 'manager', label: 'Manager', Icon: UserCheck },
  { value: 'ops_manager', label: 'Ops', Icon: null },
  { value: 'admin', label: 'Admin', Icon: Shield },
]

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useAuth()
  // Why they were sent here, when whoever sent them knew. RequireAuth uses it
  // to explain a deactivated account, which otherwise looks like a login that
  // succeeds and then silently refuses to go anywhere.
  const notice = (location.state as { notice?: string } | null)?.notice ?? ''
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState<AuthTab>('cleaner')
  const activeIndex = AUTH_TABS.findIndex((t) => t.value === activeTab)
  
  // Login state
  const [mobile, setMobile] = useState<string>('+44')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const resetForm = () => {
    setMobile('+44')
    setUsername('')
    setPassword('')
  }

  const clearClockState = () => {
    try {
      localStorage.removeItem('currentClockInData')
      localStorage.removeItem('currentClockInPhase')
      localStorage.removeItem('currentSiteName')
      localStorage.removeItem('recentClockOutAt')
    } catch {
      // no-op
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const identifier =
        activeTab === 'cleaner' || activeTab === 'manager' ? mobile : username

      // signIn handles Supabase Auth + localStorage sync via AuthContext
      await signIn(activeTab, identifier, password)

      // Only after the sign-in has actually succeeded. Clearing first meant a
      // mistyped password wiped the in-progress clock-in of whoever was using
      // the phone: a rejected attempt changes nothing about who is signed in,
      // so it must not change what they were doing. The reason for clearing at
      // all is unchanged -- a different person is now signed in on this device
      // and must not inherit the previous session's open shift.
      clearClockState()

      // Navigate based on user type
      switch (activeTab) {
        case 'cleaner':
          navigate('/cleaner-dashboard')
          break
        case 'manager':
          navigate('/manager-dashboard')
          break
        case 'ops_manager':
          navigate('/ops-dashboard')
          break
        case 'admin':
          navigate('/admin/dashboard')
          break
      }
    } catch (err: any) {
      console.error('Login error:', err)
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: err?.message || "Invalid credentials"
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="relative min-h-screen flex items-center justify-center p-4 sm:p-6"
      style={{
        backgroundImage: 'url("/cropped-view-of-african-american-cleaner-moving-vacuum-cleaner-in-office%20(1).jpg")',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div
        className="absolute inset-0 bg-gradient-to-b from-background/95 via-background/55 to-[hsl(220_60%_10%/0.88)]"
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="text-center">
          <img 
            src="/suburban_services_logo-scaled.webp" 
            alt="Suburban Services" 
            className="h-16 w-auto mx-auto mb-8"
          />
        </div>

        {/* Alerts */}
        {notice && (
          <div
            role="status"
            className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-center text-subheadline font-medium text-foreground"
          >
            {notice}
          </div>
        )}

        {/* Auth Card */}
        <Card className="glass rounded-3xl shadow-xl">
          <CardContent className="p-8 sm:p-10">
            <p className="mb-6 text-center text-subheadline font-medium text-muted-foreground">
              Sign in with your existing credentials.
            </p>

            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                setActiveTab(value as AuthTab)
                resetForm()
              }}
              className="w-full"
            >
              <TabsList className="relative grid w-full grid-cols-4 rounded-2xl p-1 mb-6 bg-muted/80 backdrop-blur border border-border">
                {/* One pill that slides between segments, the way a platform
                    segmented control behaves. Each segment is an equal grid
                    column, so it can step by exactly its own width and never
                    needs to measure the DOM. The global reduced-motion rule
                    collapses the transition for anyone who asks for that. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-1 left-1 rounded-xl bg-primary shadow-sm transition-transform duration-300 ease-apple"
                  style={{
                    width: 'calc((100% - 0.5rem) / 4)',
                    transform: `translateX(${activeIndex * 100}%)`,
                  }}
                />
                {AUTH_TABS.map(({ value, label, Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="relative z-10 min-h-[44px] rounded-xl text-subheadline font-medium py-2.5 px-3 text-muted-foreground transition-colors duration-200 data-[state=active]:bg-transparent data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                  >
                    {Icon ? <Icon className="h-4 w-4 mr-1.5" /> : null}
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Login/Register Forms */}
              <TabsContent value="cleaner" className="mt-0">
                  <form onSubmit={handleLogin} className="space-y-5">
                    <PhoneInput
                      id="mobile"
                      label="Mobile Number"
                      placeholder="Enter your phone number"
                      value={mobile}
                      onChange={setMobile}
                      required
                    />
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-foreground font-medium text-subheadline">Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-input bg-card/90 h-11 pr-12 text-callout text-foreground placeholder:text-muted-foreground"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm transition-all duration-200 hover:opacity-90 active:scale-[0.99]" 
                      disabled={loading}
                    >
                      {loading ? 'Signing in...' : 'Sign in as Cleaner'}
                    </Button>
                  </form>
              </TabsContent>

              <TabsContent value="manager" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-5">
                  <PhoneInput
                    id="mobile-mgr"
                    label="Mobile Number"
                    placeholder="Enter your phone number"
                    value={mobile}
                    onChange={setMobile}
                    required
                  />
                  <div className="space-y-2">
                    <Label htmlFor="password-mgr" className="text-foreground font-medium text-subheadline">Password</Label>
                    <div className="relative">
                      <Input
                        id="password-mgr"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="rounded-xl border-input bg-card/90 h-11 pr-12 text-callout text-foreground placeholder:text-muted-foreground"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm transition-all duration-200 hover:opacity-90 active:scale-[0.99]" 
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign in as Manager'}
                  </Button>
                </form>
                <p className="mt-4 text-caption text-center text-muted-foreground">Manager accounts are provisioned by administrators.</p>
                {/* Quick access removed */}
              </TabsContent>

              <TabsContent value="ops_manager" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="username-ops" className="text-foreground font-medium text-subheadline">Username</Label>
                    <Input
                      id="username-ops"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="rounded-xl border-input bg-card/90 h-11 text-callout text-foreground placeholder:text-muted-foreground"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password-ops" className="text-foreground font-medium text-subheadline">Password</Label>
                    <div className="relative">
                      <Input
                        id="password-ops"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="rounded-xl border-input bg-card/90 h-11 pr-12 text-callout text-foreground placeholder:text-muted-foreground"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm transition-all duration-200 hover:opacity-90 active:scale-[0.99]" 
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign in as Ops'}
                  </Button>
                </form>
                <p className="mt-4 text-caption text-center text-muted-foreground">Operations manager access is assigned by administrators.</p>
              </TabsContent>

              <TabsContent value="admin" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="username-admin" className="text-foreground font-medium text-subheadline">Username</Label>
                    <Input
                      id="username-admin"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="rounded-xl border-input bg-card/90 h-11 text-callout text-foreground placeholder:text-muted-foreground"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password-admin" className="text-foreground font-medium text-subheadline">Password</Label>
                    <div className="relative">
                      <Input
                        id="password-admin"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="rounded-xl border-input bg-card/90 h-11 pr-12 text-callout text-foreground placeholder:text-muted-foreground"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm transition-all duration-200 hover:opacity-90 active:scale-[0.99]" 
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign in as Admin'}
                  </Button>
                </form>
                <p className="mt-4 text-caption text-center text-muted-foreground">Admin access is managed centrally. Please contact system support for assistance.</p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-caption text-white/80 space-y-2">
          <p className="font-semibold">QR Code Application v1.0</p>
          <p className="flex items-center justify-center gap-2 text-white/70">
            <span>Real-time tracking</span>
            <span>•</span>
            <span>GPS enabled</span>
            <span>•</span>
            <span>Secure</span>
          </p>
        </div>
      </div>
    </div>
  )
}
