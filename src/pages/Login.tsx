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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

export default function Login() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [activeTab, setActiveTab] = useState<'cleaner' | 'manager' | 'admin'>('cleaner')
  
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const loginData = {
        mobile_number: activeTab === 'admin' ? undefined : mobile,
        username: activeTab === 'admin' ? username : undefined,
        password,
        user_type: activeTab
      }

      const result = await authService.loginUser(loginData)

      if (result.success && result.user) {
        // Store user session
        localStorage.setItem('userType', result.user.user_type)
        localStorage.setItem('userId', result.user.id)
        localStorage.setItem('userName', result.user.name)

        // Navigate based on user type
        switch (result.user.user_type) {
          case 'cleaner':
            navigate('/cleaner-dashboard')
            break
          case 'manager':
            navigate('/manager-dashboard')
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
        user_type: activeTab
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
    setError(null)
    setSuccess(null)
  }

  const toggleMode = () => {
    setIsRegisterMode(!isRegisterMode)
    resetForm()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
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
        <Card className="rounded-3xl shadow-xl border-0 bg-white">
          <CardContent className="p-8">
            {/* Header with mode toggle */}
            <div className="text-center mb-6">
              {isRegisterMode ? (
                <div className="flex items-center justify-center mb-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleMode}
                    className="gap-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-full px-3 py-2"
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
                  className="gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-full px-4 py-2 mb-4"
                >
                  <UserPlus className="h-4 w-4" />
                  Create Account
                </Button>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'cleaner' | 'manager' | 'admin')} className="w-full">
              <TabsList className="grid w-full grid-cols-3 bg-gray-50 rounded-xl p-0.5 mb-6">
                <TabsTrigger 
                  value="cleaner" 
                  className="rounded-lg text-sm font-normal py-2 px-3 data-[state=active]:bg-white data-[state=active]:shadow-none transition-all"
                >
                  <Users className="h-4 w-4 mr-1.5" />
                  Cleaner
                </TabsTrigger>
                <TabsTrigger 
                  value="manager" 
                  className="rounded-lg text-sm font-normal py-2 px-3 data-[state=active]:bg-white data-[state=active]:shadow-none transition-all"
                >
                  <UserCheck className="h-4 w-4 mr-1.5" />
                  Manager
                </TabsTrigger>
                <TabsTrigger 
                  value="admin" 
                  className="rounded-lg text-sm font-normal py-2 px-3 data-[state=active]:bg-white data-[state=active]:shadow-none transition-all"
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
                      <h3 className="text-lg font-semibold text-gray-900">Create Cleaner Account</h3>
                      <p className="text-gray-500 text-sm mt-1">Fill in your details to get started</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="reg-first-name" className="text-gray-500 font-normal text-sm">First Name</Label>
                        <Input
                          id="reg-first-name"
                          type="text"
                          value={regFirstName}
                          onChange={(e) => setRegFirstName(e.target.value)}
                          placeholder="John"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-last-name" className="text-gray-500 font-normal text-sm">Last Name</Label>
                        <Input
                          id="reg-last-name"
                          type="text"
                          value={regLastName}
                          onChange={(e) => setRegLastName(e.target.value)}
                          placeholder="Doe"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
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
                      <Label htmlFor="reg-email" className="text-gray-500 font-normal text-sm">Email <span className="text-gray-400 font-normal">(Optional)</span></Label>
                      <Input
                        id="reg-email"
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="john.doe@example.com"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-password" className="text-gray-500 font-normal text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="reg-password"
                          type={showPassword ? "text" : "password"}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 pr-12 text-sm"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-confirm-password" className="text-gray-500 font-normal text-sm">Confirm Password</Label>
                      <Input
                        id="reg-confirm-password"
                        type={showPassword ? "text" : "password"}
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                        required
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-normal shadow-sm hover:shadow-md transition-all duration-200" 
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
                      <Label htmlFor="password" className="text-gray-500 font-normal text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 pr-12 text-sm"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-normal shadow-sm hover:shadow-md transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Signing in...' : 'Sign in as Cleaner'}
                    </Button>
                  </form>
                )}
              </TabsContent>

              <TabsContent value="manager" className="mt-0">
                {isRegisterMode ? (
                  <form onSubmit={handleRegister} className="space-y-5">
                    <div className="text-center mb-6">
                      <h3 className="text-lg font-semibold text-gray-900">Create Manager Account</h3>
                      <p className="text-gray-500 text-sm mt-1">Fill in your details to get started</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="reg-first-name-mgr" className="text-gray-500 font-normal text-sm">First Name</Label>
                        <Input
                          id="reg-first-name-mgr"
                          type="text"
                          value={regFirstName}
                          onChange={(e) => setRegFirstName(e.target.value)}
                          placeholder="John"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-last-name-mgr" className="text-gray-500 font-normal text-sm">Last Name</Label>
                        <Input
                          id="reg-last-name-mgr"
                          type="text"
                          value={regLastName}
                          onChange={(e) => setRegLastName(e.target.value)}
                          placeholder="Doe"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                          required
                        />
                      </div>
                    </div>

                    <PhoneInput
                      id="reg-mobile-mgr"
                      label="Mobile Number"
                      placeholder="Enter your phone number"
                      value={regMobile}
                      onChange={setRegMobile}
                      required
                    />

                    <div className="space-y-2">
                      <Label htmlFor="reg-email-mgr" className="text-gray-500 font-normal text-sm">Email <span className="text-gray-400 font-normal">(Optional)</span></Label>
                      <Input
                        id="reg-email-mgr"
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="john.doe@example.com"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-password-mgr" className="text-gray-500 font-normal text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="reg-password-mgr"
                          type={showPassword ? "text" : "password"}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 pr-12 text-sm"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-confirm-password-mgr" className="text-gray-500 font-normal text-sm">Confirm Password</Label>
                      <Input
                        id="reg-confirm-password-mgr"
                        type={showPassword ? "text" : "password"}
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                        required
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Creating Account...' : 'Create Manager Account'}
                    </Button>
                  </form>
                ) : (
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
                      <Label htmlFor="password-mgr" className="text-gray-500 font-normal text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="password-mgr"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 pr-12 text-sm"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-normal shadow-sm hover:shadow-md transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Signing in...' : 'Sign in as Manager'}
                    </Button>
                  </form>
                )}
              </TabsContent>

              <TabsContent value="admin" className="mt-0">
                {isRegisterMode ? (
                  <form onSubmit={handleRegister} className="space-y-5">
                    <div className="text-center mb-6">
                      <h3 className="text-lg font-semibold text-gray-900">Create Admin Account</h3>
                      <p className="text-gray-500 text-sm mt-1">Fill in your details to get started</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="reg-first-name-admin" className="text-gray-500 font-normal text-sm">First Name</Label>
                        <Input
                          id="reg-first-name-admin"
                          type="text"
                          value={regFirstName}
                          onChange={(e) => setRegFirstName(e.target.value)}
                          placeholder="John"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-last-name-admin" className="text-gray-500 font-normal text-sm">Last Name</Label>
                        <Input
                          id="reg-last-name-admin"
                          type="text"
                          value={regLastName}
                          onChange={(e) => setRegLastName(e.target.value)}
                          placeholder="Doe"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                          required
                        />
                      </div>
                    </div>

                    <PhoneInput
                      id="reg-mobile-admin"
                      label="Mobile Number"
                      placeholder="Enter your phone number"
                      value={regMobile}
                      onChange={setRegMobile}
                      required
                    />

                    <div className="space-y-2">
                      <Label htmlFor="reg-email-admin" className="text-gray-500 font-normal text-sm">Email</Label>
                      <Input
                        id="reg-email-admin"
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="admin@example.com"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-password-admin" className="text-gray-500 font-normal text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="reg-password-admin"
                          type={showPassword ? "text" : "password"}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 pr-12 text-sm"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-confirm-password-admin" className="text-gray-500 font-normal text-sm">Confirm Password</Label>
                      <Input
                        id="reg-confirm-password-admin"
                        type={showPassword ? "text" : "password"}
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                        required
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-normal shadow-sm hover:shadow-md transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Creating Account...' : 'Create Account'}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={handleLogin} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="username-admin" className="text-gray-500 font-normal text-sm">Username</Label>
                      <Input
                        id="username-admin"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter your username"
                        className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 text-sm"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password-admin" className="text-gray-500 font-normal text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="password-admin"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="rounded-xl border-gray-100 focus:border-gray-300 focus:ring-gray-200/50 h-11 pr-12 text-sm"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-11 w-11 hover:bg-transparent text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-normal shadow-sm hover:shadow-md transition-all duration-200" 
                      disabled={loading}
                    >
                      {loading ? 'Signing in...' : 'Sign in as Admin'}
                    </Button>
                  </form>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 space-y-2">
          <p className="font-medium">QR Code Application v1.0</p>
          <p className="flex items-center justify-center gap-2 text-gray-300">
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
