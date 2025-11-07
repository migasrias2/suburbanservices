import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Users, UserCheck, Shield, UserPlus, ArrowLeft } from 'lucide-react'
import { PhoneInput } from '../components/ui/phone-input'
import { authService } from '../services/authService'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { setStoredCleanerName } from '../lib/identity'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

export default function Login() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  type AuthTab = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

  const [activeTab, setActiveTab] = useState<AuthTab>('cleaner')
  
  // Login state
  const [mobile, setMobile] = useState<string>('+44')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  
  // Registration state
  const [regMobile, setRegMobile] = useState<string>('+44')
  const [regFirstName, setRegFirstName] = useState('')
  const [regLastName, setRegLastName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirmPassword, setRegConfirmPassword] = useState('')

  const resetForm = () => {
    setMobile('+44')
    setUsername('')
    setPassword('')
    setRegMobile('+44')
    setRegFirstName('')
    setRegLastName('')
    setRegEmail('')
    setRegPassword('')
    setRegConfirmPassword('')
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
      const loginData = {
        mobile_number: activeTab === 'cleaner' || activeTab === 'manager' ? mobile : undefined,
        username: activeTab === 'admin' || activeTab === 'ops_manager' ? username : undefined,
        password,
        user_type: activeTab
      }

      const result = await authService.loginUser(loginData)

      if (result.success && result.user) {
        const normalizedName = setStoredCleanerName(result.user.name)

        // Store user session
        clearClockState()
        localStorage.setItem('userType', result.user.user_type)
        localStorage.setItem('userId', result.user.id)
        if (result.user.mobile_number) {
          localStorage.setItem('userMobile', result.user.mobile_number)
        } else {
          localStorage.removeItem('userMobile')
        }
        setStoredCleanerName(normalizedName)

        // Navigate based on user type
        switch (result.user.user_type) {
          case 'cleaner':
            navigate('/clock-in')
            break
          case 'manager':
            navigate('/manager-dashboard')
            break
          case 'ops_manager':
            navigate('/ops-dashboard')
            break
          case 'admin':
            navigate('/admin-dashboard')
            break
        }
      } else {
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: result.error || "Invalid credentials"
        })
      }
    } catch (err) {
      console.error('Login error:', err)
      toast({
        variant: "destructive",
        title: "Login Error",
        description: "Login failed. Please try again."
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (activeTab !== 'cleaner') {
      toast({
        variant: "destructive",
        title: "Registration Restricted",
        description: "Only cleaner accounts can be created from this screen."
      })
      setLoading(false)
      return
    }

    // Validation
    if (!regMobile || !regFirstName.trim() || !regLastName.trim() || !regPassword.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please fill in all required fields"
      })
      setLoading(false)
      return
    }

    if (regPassword !== regConfirmPassword) {
      toast({
        variant: "destructive",
        title: "Password Mismatch",
        description: "Passwords do not match"
      })
      setLoading(false)
      return
    }

    if (regPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "Weak Password",
        description: "Password must be at least 6 characters long"
      })
      setLoading(false)
      return
    }

    try {
      const userData = {
        mobile_number: regMobile,
        first_name: regFirstName,
        last_name: regLastName,
        email: regEmail,
        password: regPassword,
        user_type: 'cleaner'
      }

      const result = await authService.registerUser(userData)

      if (result.success) {
        toast({
          variant: "success",
          title: "Account Created!",
          description: "You can now sign in with your credentials"
        })
        setIsRegisterMode(false)
        // Clear registration form
        setRegMobile('+44')
        setRegFirstName('')
        setRegLastName('')
        setRegEmail('')
        setRegPassword('')
        setRegConfirmPassword('')
      } else {
        toast({
          variant: "destructive",
          title: "Registration Failed",
          description: result.error || "Something went wrong during registration"
        })
      }
    } catch (err) {
      console.error('Registration error:', err)
      toast({
        variant: "destructive",
        title: "Registration Error",
        description: "Registration failed. Please try again."
      })
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    if (activeTab !== 'cleaner') {
      return
    }
    setIsRegisterMode(!isRegisterMode)
    resetForm()
  }

  const handleDemoLogin = async (userType: string, name: string) => {
    setLoading(true)
    try {
      const loginData = {
        mobile_number: '+44', // Placeholder, replace with actual demo number
        username: 'demo', // Placeholder, replace with actual demo username
        password: 'demo123', // Placeholder, replace with actual demo password
        user_type: userType
      }

      const result = await authService.loginUser(loginData)

      if (result.success && result.user) {
        const normalizedName = setStoredCleanerName(name)

        // Store user session
        localStorage.setItem('userType', result.user.user_type)
        localStorage.setItem('userId', result.user.id)
        if (result.user.mobile_number) {
          localStorage.setItem('userMobile', result.user.mobile_number)
        } else {
          localStorage.removeItem('userMobile')
        }
        setStoredCleanerName(normalizedName)

        // Navigate based on user type
        switch (result.user.user_type) {
          case 'cleaner':
            navigate('/clock-in')
            break
          case 'manager':
            navigate('/manager-dashboard')
            break
          case 'ops_manager':
            navigate('/ops-dashboard')
            break
          case 'admin':
            navigate('/admin-dashboard')
            break
        }
      } else {
        toast({
          variant: "destructive",
          title: "Demo Login Failed",
          description: result.error || "Invalid demo credentials"
        })
      }
    } catch (err) {
      console.error('Demo Login error:', err)
      toast({
        variant: "destructive",
        title: "Demo Login Error",
        description: "Demo login failed. Please try again."
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
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(0,27,68,0.7) 100%)'
        }}
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

        {/* Auth Card */}
        <Card className="rounded-3xl border border-white/30 bg-white/90 backdrop-blur-xl shadow-2xl shadow-blue-950/30">
          <CardContent className="p-8 sm:p-10">
            {/* Header with mode toggle */}
            <div className="text-center mb-6">
              {activeTab === 'cleaner' ? (
                isRegisterMode ? (
                  <div className="flex items-center justify-center mb-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleMode}
                    className="gap-2 text-[#0b2f6b] hover:text-[#07204a] hover:bg-[#0b2f6b]/10 rounded-full px-3 py-2"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to Sign In
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleMode}
                    className="gap-2 text-[#0b2f6b] hover:text-[#07204a] hover:bg-[#0b2f6b]/10 rounded-full px-4 py-2 mb-2"
                  >
                    <UserPlus className="h-4 w-4" />
                    Create Account
                  </Button>
                )
              ) : (
                <p className="text-sm font-medium text-[#0b2f6b]/60">Sign in with your existing credentials.</p>
              )}
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const nextTab = value as AuthTab
                setActiveTab(nextTab)
                if (nextTab !== 'cleaner') {
                  setIsRegisterMode(false)
                }
                resetForm()
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-4 rounded-2xl p-1 mb-6 bg-[#0b2f6b]/8 backdrop-blur border border-[#0b2f6b]/20">
                <TabsTrigger 
                  value="cleaner" 
                  className="rounded-xl text-sm font-medium py-2.5 px-3 text-[#0b2f6b]/80 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#0b2f6b] data-[state=active]:to-[#021540] data-[state=active]:text-white data-[state=active]:shadow-lg"
                >
                  <Users className="h-4 w-4 mr-1.5" />
                  Cleaner
                </TabsTrigger>
                <TabsTrigger 
                  value="manager" 
                  className="rounded-xl text-sm font-medium py-2.5 px-3 text-[#0b2f6b]/80 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#0b2f6b] data-[state=active]:to-[#021540] data-[state=active]:text-white data-[state=active]:shadow-lg"
                >
                  <UserCheck className="h-4 w-4 mr-1.5" />
                  Manager
                </TabsTrigger>
                <TabsTrigger 
                  value="ops_manager" 
                  className="rounded-xl text-sm font-medium py-2.5 px-3 text-[#0b2f6b]/80 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#0b2f6b] data-[state=active]:to-[#021540] data-[state=active]:text-white data-[state=active]:shadow-lg"
                >
                  Ops
                </TabsTrigger>
                <TabsTrigger 
                  value="admin" 
                  className="rounded-xl text-sm font-medium py-2.5 px-3 text-[#0b2f6b]/80 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#0b2f6b] data-[state=active]:to-[#021540] data-[state=active]:text-white data-[state=active]:shadow-lg"
                >
                  <Shield className="h-4 w-4 mr-1.5" />
                  Admin
                </TabsTrigger>
              </TabsList>

              {/* Login/Register Forms */}
              <TabsContent value="cleaner" className="mt-0">
                {isRegisterMode ? (
                  <form onSubmit={handleRegister} className="space-y-5">
                    <div className="text-center mb-6">
                      <h3 className="text-lg font-semibold text-[#0b2f6b]">Create Cleaner Account</h3>
                      <p className="text-[#0b2f6b]/60 text-sm mt-1">Fill in your details to get started</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="reg-first-name" className="text-[#0b2f6b]/80 font-medium text-sm">First Name</Label>
                        <Input
                          id="reg-first-name"
                          type="text"
                          value={regFirstName}
                          onChange={(e) => setRegFirstName(e.target.value)}
                          placeholder="John"
                          className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-last-name" className="text-[#0b2f6b]/80 font-medium text-sm">Last Name</Label>
                        <Input
                          id="reg-last-name"
                          type="text"
                          value={regLastName}
                          onChange={(e) => setRegLastName(e.target.value)}
                          placeholder="Doe"
                          className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                          required
                        />
                      </div>
                    </div>

                    <PhoneInput
                      id="reg-mobile"
                      label="Mobile Number"
                      placeholder="Enter your phone number"
                      value={regMobile}
                      onChange={setRegMobile}
                      required
                    />

                    <div className="space-y-2">
                      <Label htmlFor="reg-email" className="text-[#0b2f6b]/80 font-medium text-sm">Email <span className="text-[#0b2f6b]/50 font-normal">(Optional)</span></Label>
                      <Input
                        id="reg-email"
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="john.doe@example.com"
                        className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-password" className="text-[#0b2f6b]/80 font-medium text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="reg-password"
                          type={showPassword ? "text" : "password"}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 pr-12 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-[#0b2f6b]/40 hover:text-[#0b2f6b]"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-confirm-password" className="text-[#0b2f6b]/80 font-medium text-sm">Confirm Password</Label>
                      <Input
                        id="reg-confirm-password"
                        type={showPassword ? "text" : "password"}
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                        required
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-[#0b2f6b] to-[#021540] hover:from-[#07204a] hover:to-[#010a27] text-white font-semibold shadow-lg shadow-[#0b2f6b]/30 transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Creating Account...' : 'Create Account'}
                    </Button>
                  </form>
                ) : (
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
                      <Label htmlFor="password" className="text-[#0b2f6b]/80 font-medium text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 pr-12 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-[#0b2f6b]/40 hover:text-[#0b2f6b]"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-[#0b2f6b] to-[#021540] hover:from-[#07204a] hover:to-[#010a27] text-white font-semibold shadow-lg shadow-[#0b2f6b]/30 transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Signing in...' : 'Sign in as Cleaner'}
                    </Button>
                  </form>
                )}
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
                    <Label htmlFor="password-mgr" className="text-[#0b2f6b]/80 font-medium text-sm">Password</Label>
                    <div className="relative">
                      <Input
                        id="password-mgr"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 pr-12 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-[#0b2f6b]/40 hover:text-[#0b2f6b]"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-[#0b2f6b] to-[#021540] hover:from-[#07204a] hover:to-[#010a27] text-white font-semibold shadow-lg shadow-[#0b2f6b]/30 transition-all duration-200" 
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign in as Manager'}
                  </Button>
                </form>
                <p className="mt-4 text-xs text-center text-[#0b2f6b]/60">Manager accounts are provisioned by administrators.</p>
              </TabsContent>

              <TabsContent value="ops_manager" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="username-ops" className="text-[#0b2f6b]/80 font-medium text-sm">Username</Label>
                    <Input
                      id="username-ops"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password-ops" className="text-[#0b2f6b]/80 font-medium text-sm">Password</Label>
                    <div className="relative">
                      <Input
                        id="password-ops"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 pr-12 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-[#0b2f6b]/40 hover:text-[#0b2f6b]"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-[#0b2f6b] to-[#021540] hover:from-[#07204a] hover:to-[#010a27] text-white font-semibold shadow-lg shadow-[#0b2f6b]/30 transition-all duration-200" 
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign in as Ops'}
                  </Button>
                </form>
                <p className="mt-4 text-xs text-center text-[#0b2f6b]/60">Operations manager access is assigned by administrators.</p>
              </TabsContent>

              <TabsContent value="admin" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="username-admin" className="text-[#0b2f6b]/80 font-medium text-sm">Username</Label>
                    <Input
                      id="username-admin"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password-admin" className="text-[#0b2f6b]/80 font-medium text-sm">Password</Label>
                    <div className="relative">
                      <Input
                        id="password-admin"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="rounded-xl border-[#0b2f6b]/20 bg-white/90 focus:border-[#0b2f6b]/40 focus:ring-2 focus:ring-[#0b2f6b]/30 h-11 pr-12 text-sm text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-[#0b2f6b]/40 hover:text-[#0b2f6b]"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-[#0b2f6b] to-[#021540] hover:from-[#07204a] hover:to-[#010a27] text-white font-semibold shadow-lg shadow-[#0b2f6b]/30 transition-all duration-200" 
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign in as Admin'}
                  </Button>
                </form>
                <p className="mt-4 text-xs text-center text-[#0b2f6b]/60">Admin access is managed centrally. Please contact system support for assistance.</p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-blue-100/80 space-y-2">
          <p className="font-semibold">QR Code Application v1.0</p>
          <p className="flex items-center justify-center gap-2 text-blue-100/70">
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
