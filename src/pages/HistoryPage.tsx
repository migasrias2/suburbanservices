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
      <div className="flex justify-center items-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary/40 border-t-transparent"></div>
      </div>
    )
  }

  useEffect(() => {
    loadRecentScans()
  }, [userId])

  const loadRecentScans = async () => {
    const { data, error } = await supabase
      .from('cleaner_logs')
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary/40"></div>
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={(userType || 'cleaner') as 'cleaner' | 'manager' | 'ops_manager' | 'admin'} userName={userName}>
      <div className="space-y-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="p-4 rounded-2xl bg-primary/10">
              <FileText className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold text-primary">
            Activity History
          </h1>
          <p className="text-muted-foreground text-lg">Your recent cleaning activities and QR code scans</p>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-primary mb-1">{recentScans.length}</div>
              <div className="text-sm text-muted-foreground">Total Activities</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-success mb-1">
                {recentScans.filter(scan => scan.action.includes('Clock In')).length}
              </div>
              <div className="text-sm text-muted-foreground">Clock Ins</div>
            </CardContent>
          </Card>
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-primary mb-1">
                {new Set(recentScans.map(scan => scan.site_area).filter(Boolean)).size}
              </div>
              <div className="text-sm text-muted-foreground">Locations</div>
            </CardContent>
          </Card>
        </div>

        {/* Activity List */}
        <Card className="card-modern border-0 shadow-xl">
          <CardContent className="p-6">
            <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
              <Clock className="h-6 w-6 text-primary" />
              Recent Activity
            </h2>
            
            <div className="space-y-4">
              {recentScans.length > 0 ? (
                <div className="space-y-3">
                  {recentScans.map((scan) => (
                    <div key={scan.id} className="card-modern border-0 shadow-lg p-4 hover:shadow-xl transition-shadow">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-primary/10">
                          <QrCode className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-foreground">{scan.action}</span>
                            <Badge className="bg-primary/10 text-primary hover:bg-primary/10 rounded-full">
                              {scan.site_area}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{new Date(scan.timestamp).toLocaleString()}</span>
                            {scan.customer_name && (
                              <span>• {scan.customer_name}</span>
                            )}
                          </div>
                        </div>
                        {scan.location_lat && scan.location_lng && (
                          <div className="flex items-center gap-1 text-sm text-success">
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
                  <QrCode className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground text-lg">No activity recorded yet</p>
                  <p className="text-muted-foreground">Start scanning QR codes to see your history</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Sidebar07Layout>
  )
}
