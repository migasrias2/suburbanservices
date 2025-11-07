import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { supabase } from '../services/supabase'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { FileText, QrCode, MapPin, Clock } from 'lucide-react'
import { getStoredCleanerName } from '../lib/identity'

export default function HistoryPage() {
  const navigate = useNavigate()
  const [recentScans, setRecentScans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userType, setUserType] = useState<'cleaner' | 'manager' | 'ops_manager' | 'admin' | ''>('')
  const [userId, setUserId] = useState<string>('')
  const [userName, setUserName] = useState<string>('')

  useEffect(() => {
    // Get user info from localStorage
    const type = localStorage.getItem('userType')
    const id = localStorage.getItem('userId')
    const name = getStoredCleanerName()

    if (!type || !id || !name) {
      navigate('/login')
      return
    }

    setUserType(type as 'cleaner' | 'manager' | 'ops_manager' | 'admin')
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
    loadRecentScans()
  }, [userId])

  const loadRecentScans = async () => {
    const { data, error } = await supabase
      .from('uk_cleaner_logs')
      .select('*')
      .eq('cleaner_id', userId)
      .order('timestamp', { ascending: false })
      .limit(50)

    if (!error && data) {
      setRecentScans(data)
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
    <Sidebar07Layout userType={(userType || 'cleaner') as 'cleaner' | 'manager' | 'ops_manager' | 'admin'} userName={userName}>
      <div className="space-y-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="p-4 rounded-2xl bg-blue-100">
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Activity History
          </h1>
          <p className="text-gray-600 text-lg">Your recent cleaning activities and QR code scans</p>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600 mb-1">{recentScans.length}</div>
              <div className="text-sm text-gray-600">Total Activities</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600 mb-1">
                {recentScans.filter(scan => scan.action.includes('Clock In')).length}
              </div>
              <div className="text-sm text-gray-600">Clock Ins</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-indigo-600 mb-1">
                {new Set(recentScans.map(scan => scan.site_area).filter(Boolean)).size}
              </div>
              <div className="text-sm text-gray-600">Locations</div>
            </CardContent>
          </Card>
        </div>

        {/* Activity List */}
        <Card className="card-modern border-0 shadow-xl">
          <CardContent className="p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <Clock className="h-6 w-6 text-blue-600" />
              Recent Activity
            </h2>
            
            <div className="space-y-4">
              {recentScans.length > 0 ? (
                <div className="space-y-3">
                  {recentScans.map((scan) => (
                    <div key={scan.id} className="card-modern border-0 shadow-lg p-4 hover:shadow-xl transition-shadow">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-blue-100">
                          <QrCode className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">{scan.action}</span>
                            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-full">
                              {scan.site_area}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span>{new Date(scan.timestamp).toLocaleString()}</span>
                            {scan.customer_name && (
                              <span>• {scan.customer_name}</span>
                            )}
                          </div>
                        </div>
                        {scan.location_lat && scan.location_lng && (
                          <div className="flex items-center gap-1 text-sm text-green-600">
                            <MapPin className="h-4 w-4" />
                            <span>Located</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <QrCode className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">No activity recorded yet</p>
                  <p className="text-gray-400">Start scanning QR codes to see your history</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Sidebar07Layout>
  )
}
