import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { supabase, UKCleaner } from '../services/supabase'
import { Card, CardContent } from '../components/ui/card'
import { User, Phone, Mail, Building, Hash, Users } from 'lucide-react'

export default function ProfilePage() {
  const navigate = useNavigate()
  const [cleaner, setCleaner] = useState<UKCleaner | null>(null)
  const [loading, setLoading] = useState(true)
  const [userType, setUserType] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [userName, setUserName] = useState<string>('')

  useEffect(() => {
    // Get user info from localStorage
    const type = localStorage.getItem('userType')
    const id = localStorage.getItem('userId')
    const name = localStorage.getItem('userName')

    if (!type || !id || !name) {
      navigate('/login')
      return
    }

    setUserType(type)
    setUserId(id)
    setUserName(name)
  }, [navigate])

  if (!userType || !userId || !userName) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  useEffect(() => {
    loadCleanerData()
  }, [userId])

  const loadCleanerData = async () => {
    const { data, error } = await supabase
      .from('uk_cleaners')
      .select('*')
      .eq('cleaner_id', userId)
      .single()

    if (!error && data) {
      setCleaner(data)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType as 'cleaner' | 'manager' | 'admin'} userName={userName}>
      <div className="space-y-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center">
              <span className="text-white font-bold text-2xl">
                {userName.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {userName}
          </h1>
          <p className="text-gray-600 text-lg capitalize">{userType} Profile</p>
        </div>

        {/* Profile Information */}
        <Card className="card-modern border-0 shadow-xl">
          <CardContent className="p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <User className="h-6 w-6 text-blue-600" />
              Personal Information
            </h2>
            
            {cleaner ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                      <User className="h-4 w-4" />
                      First Name
                    </label>
                    <p className="text-lg text-gray-900 bg-gray-50 p-3 rounded-xl">
                      {cleaner.first_name || 'Not provided'}
                    </p>
                  </div>
                  
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                      <User className="h-4 w-4" />
                      Last Name
                    </label>
                    <p className="text-lg text-gray-900 bg-gray-50 p-3 rounded-xl">
                      {cleaner.last_name || 'Not provided'}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <Phone className="h-4 w-4" />
                    Mobile Number
                  </label>
                  <p className="text-lg text-gray-900 bg-gray-50 p-3 rounded-xl">
                    {cleaner.mobile_number || 'Not provided'}
                  </p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                    <Mail className="h-4 w-4" />
                    Email Address
                  </label>
                  <p className="text-lg text-gray-900 bg-gray-50 p-3 rounded-xl">
                    {cleaner.email_address || 'Not provided'}
                  </p>
                </div>

                {cleaner.employee_number && (
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                      <Hash className="h-4 w-4" />
                      Employee Number
                    </label>
                    <p className="text-lg text-gray-900 bg-gray-50 p-3 rounded-xl">
                      {cleaner.employee_number}
                    </p>
                  </div>
                )}

                {cleaner.customer_name && (
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
                      <Building className="h-4 w-4" />
                      Assigned Customer
                    </label>
                    <p className="text-lg text-gray-900 bg-gray-50 p-3 rounded-xl">
                      {cleaner.customer_name}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Unable to load profile information</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="card-modern border-0 shadow-lg">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <button 
                onClick={() => navigate('/cleaner-dashboard')}
                className="w-full text-left p-3 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors text-blue-700 font-medium"
              >
                → Go to Dashboard
              </button>
              <button 
                onClick={() => navigate('/scanner')}
                className="w-full text-left p-3 rounded-xl bg-green-50 hover:bg-green-100 transition-colors text-green-700 font-medium"
              >
                → Open Scanner
              </button>
              <button 
                onClick={() => navigate('/history')}
                className="w-full text-left p-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 transition-colors text-indigo-700 font-medium"
              >
                → View History
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Sidebar07Layout>
  )
}
