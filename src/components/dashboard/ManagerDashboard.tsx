import React, { useState, useEffect } from 'react'
import { Users, MapPin, Clock, QrCode, BarChart3, Download, Settings } from 'lucide-react'
import { QRGenerator } from '../qr/QRGenerator'
import { QRService, QRCodeData } from '../../services/qrService'
import { supabase } from '../../services/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

interface ManagerDashboardProps {
  managerId: string
  managerName: string
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
  managerId,
  managerName
}) => {
  const [activeCleaners, setActiveCleaners] = useState<any[]>([])
  const [sites, setSites] = useState<any[]>([])
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [dailyStats, setDailyStats] = useState({
    totalCleaners: 0,
    activeSites: 0,
    completedTasks: 0,
    qrScans: 0
  })
  const [selectedCustomer, setSelectedCustomer] = useState<string>('all')
  const [customers, setCustomers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
    
    // Set up real-time updates
    const interval = setInterval(() => {
      loadActiveCleaners()
      loadRecentActivity()
    }, 15000) // Update every 15 seconds

    return () => clearInterval(interval)
  }, [selectedCustomer])

  const loadDashboardData = async () => {
    await Promise.all([
      loadActiveCleaners(),
      loadSites(),
      loadRecentActivity(),
      loadDailyStats(),
      loadCustomers()
    ])
    setLoading(false)
  }

  const loadActiveCleaners = async () => {
    let query = supabase
      .from('uk_cleaner_live_tracking')
      .select(`
        *,
        uk_cleaners (cleaner_name, customer_name, mobile_number),
        uk_sites (name, address)
      `)
      .eq('is_active', true)
      .order('timestamp', { ascending: false })

    if (selectedCustomer !== 'all') {
      query = query.eq('customer_name', selectedCustomer)
    }

    const { data, error } = await query

    if (!error && data) {
      setActiveCleaners(data)
    }
  }

  const loadSites = async () => {
    let query = supabase
      .from('uk_sites')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (selectedCustomer !== 'all') {
      query = query.eq('customer_name', selectedCustomer)
    }

    const { data, error } = await query

    if (!error && data) {
      setSites(data)
    }
  }

  const loadRecentActivity = async () => {
    let query = supabase
      .from('uk_cleaner_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(20)

    if (selectedCustomer !== 'all') {
      query = query.eq('customer_name', selectedCustomer)
    }

    const { data, error } = await query

    if (!error && data) {
      setRecentActivity(data)
    }
  }

  const loadDailyStats = async () => {
    const today = new Date().toISOString().split('T')[0]
    
    // Get today's logs
    let logsQuery = supabase
      .from('uk_cleaner_logs')
      .select('*')
      .gte('timestamp', `${today}T00:00:00.000Z`)
      .lt('timestamp', `${today}T23:59:59.999Z`)

    if (selectedCustomer !== 'all') {
      logsQuery = logsQuery.eq('customer_name', selectedCustomer)
    }

    const { data: logs } = await logsQuery

    // Get active cleaners count
    let cleanersQuery = supabase
      .from('uk_cleaner_live_tracking')
      .select('cleaner_id')
      .eq('is_active', true)

    const { data: cleaners } = await cleanersQuery

    // Get active sites count
    let sitesQuery = supabase
      .from('uk_sites')
      .select('site_id')
      .eq('is_active', true)

    if (selectedCustomer !== 'all') {
      sitesQuery = sitesQuery.eq('customer_name', selectedCustomer)
    }

    const { data: sitesData } = await sitesQuery

    setDailyStats({
      totalCleaners: cleaners?.length || 0,
      activeSites: sitesData?.length || 0,
      completedTasks: logs?.filter(log => log.action === 'Task Completed').length || 0,
      qrScans: logs?.length || 0
    })
  }

  const loadCustomers = async () => {
    const { data, error } = await supabase
      .from('uk_customers')
      .select('name')
      .order('name')

    if (!error && data) {
      setCustomers(data.map(c => c.name).filter(Boolean))
    }
  }

  const handleQRGenerated = (qrData: QRCodeData, qrImage: string) => {
    console.log('QR Generated:', qrData)
    // Refresh sites data if a new QR was generated
    loadSites()
  }

  const exportData = async () => {
    const today = new Date().toISOString().split('T')[0]
    
    let query = supabase
      .from('uk_cleaner_logs')
      .select('*')
      .gte('timestamp', `${today}T00:00:00.000Z`)
      .lt('timestamp', `${today}T23:59:59.999Z`)
      .order('timestamp', { ascending: false })

    if (selectedCustomer !== 'all') {
      query = query.eq('customer_name', selectedCustomer)
    }

    const { data, error } = await query

    if (!error && data) {
      // Convert to CSV
      const headers = ['Timestamp', 'Cleaner', 'Action', 'Site Area', 'Customer', 'QR Code']
      const csvContent = [
        headers.join(','),
        ...data.map(row => [
          row.timestamp,
          row.cleaner_name,
          row.action,
          row.site_area || '',
          row.customer_name || '',
          row.qr_code_scanned || ''
        ].map(field => `"${field}"`).join(','))
      ].join('\n')

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `cleaner-activity-${today}.csv`
      link.click()
      window.URL.revokeObjectURL(url)
    }
  }

  const getStatusColor = (eventType: string) => {
    switch (eventType?.toLowerCase()) {
      case 'clock_in': return 'bg-green-500'
      case 'clock_out': return 'bg-red-500'
      case 'area_scan': return 'bg-blue-500'
      case 'task_started': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Operations Dashboard</h1>
          <p className="text-gray-600">Welcome, {managerName}</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((customer) => (
                <SelectItem key={customer} value={customer}>
                  {customer}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={exportData} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-blue-600">{dailyStats.totalCleaners}</div>
            <div className="text-sm text-gray-600">Active Cleaners</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <MapPin className="h-6 w-6 text-green-600" />
            </div>
            <div className="text-2xl font-bold text-green-600">{dailyStats.activeSites}</div>
            <div className="text-sm text-gray-600">Active Sites</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <Clock className="h-6 w-6 text-purple-600" />
            </div>
            <div className="text-2xl font-bold text-purple-600">{dailyStats.completedTasks}</div>
            <div className="text-sm text-gray-600">Tasks Completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center mb-2">
              <QrCode className="h-6 w-6 text-orange-600" />
            </div>
            <div className="text-2xl font-bold text-orange-600">{dailyStats.qrScans}</div>
            <div className="text-sm text-gray-600">QR Scans Today</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cleaners">Cleaners</TabsTrigger>
          <TabsTrigger value="qr-generator">QR Generator</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Active Cleaners */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Active Cleaners ({activeCleaners.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {activeCleaners.map((cleaner) => (
                    <div key={cleaner.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      <Badge className={getStatusColor(cleaner.event_type)}>
                        {cleaner.event_type?.replace('_', ' ').toUpperCase() || 'ACTIVE'}
                      </Badge>
                      <div className="flex-1">
                        <p className="font-medium">{cleaner.uk_cleaners?.cleaner_name}</p>
                        <p className="text-sm text-gray-600">{cleaner.site_area}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(cleaner.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      {cleaner.latitude && cleaner.longitude && (
                        <MapPin className="h-4 w-4 text-green-600" />
                      )}
                    </div>
                  ))}
                  {activeCleaners.length === 0 && (
                    <p className="text-center text-gray-600 py-4">No active cleaners</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {recentActivity.slice(0, 10).map((activity) => (
                    <div key={activity.id} className="flex items-center gap-3 p-2 border-l-4 border-blue-500">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{activity.cleaner_name}</span>
                          <Badge variant="outline" className="text-xs">
                            {activity.action}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600">{activity.site_area}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(activity.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cleaners" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Active Cleaners</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeCleaners.map((cleaner) => (
                  <Card key={cleaner.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={getStatusColor(cleaner.event_type)}>
                          {cleaner.event_type?.replace('_', ' ').toUpperCase() || 'ACTIVE'}
                        </Badge>
                      </div>
                      <h3 className="font-medium">{cleaner.uk_cleaners?.cleaner_name}</h3>
                      <p className="text-sm text-gray-600">{cleaner.site_area}</p>
                      <p className="text-sm text-gray-600">
                        Customer: {cleaner.uk_cleaners?.customer_name}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Last update: {new Date(cleaner.timestamp).toLocaleString()}
                      </p>
                      {cleaner.latitude && cleaner.longitude && (
                        <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                          <MapPin className="h-3 w-3" />
                          GPS Tracked
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qr-generator" className="space-y-4">
          <QRGenerator onQRGenerated={handleQRGenerated} />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Activity Reports
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium">Today's Activity Log</h3>
                  <Button onClick={exportData} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
                
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 grid grid-cols-5 gap-4 text-sm font-medium">
                    <div>Time</div>
                    <div>Cleaner</div>
                    <div>Action</div>
                    <div>Location</div>
                    <div>Customer</div>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {recentActivity.map((activity) => (
                      <div key={activity.id} className="px-4 py-2 grid grid-cols-5 gap-4 text-sm border-t">
                        <div>{new Date(activity.timestamp).toLocaleTimeString()}</div>
                        <div>{activity.cleaner_name}</div>
                        <div>
                          <Badge variant="outline" className="text-xs">
                            {activity.action}
                          </Badge>
                        </div>
                        <div>{activity.site_area || '-'}</div>
                        <div>{activity.customer_name || '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
