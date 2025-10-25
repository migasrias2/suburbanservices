import React, { useState, useEffect } from 'react'
import { Clock, MapPin, CheckCircle2, AlertCircle, QrCode, BarChart3, ClipboardCheck, ListTodo } from 'lucide-react'
import { supabase, UKCleaner, LiveTracking } from '../../services/supabase'
import { QRService, TaskSelection, AreaType, AREA_TASKS } from '../../services/qrService'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Alert, AlertDescription } from '../ui/alert'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../ui/chart'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { BathroomAssistPanel } from '../qr/BathroomAssistPanel'

interface CleanerDashboardProps {
  cleanerId: string
  cleanerName: string
}

export const CleanerDashboard: React.FC<CleanerDashboardProps> = ({
  cleanerId,
  cleanerName
}) => {
  const [cleaner, setCleaner] = useState<UKCleaner | null>(null)
  const [currentStatus, setCurrentStatus] = useState<LiveTracking | null>(null)
  const [todayStats, setTodayStats] = useState({
    scans: 0,
    clockIns: 0,
    areas: 0,
    duration: 0,
    tasksSelected: 0,
    tasksCompleted: 0
  })
  const [weeklyData, setWeeklyData] = useState<any[]>([])
  const [activityData, setActivityData] = useState<any[]>([])
  const [taskSelections, setTaskSelections] = useState<TaskSelection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCleanerData()
    loadCurrentStatus()
    loadTodayStats()
    loadWeeklyData()
    loadTodayTasks()

    // Set up real-time updates
    const interval = setInterval(() => {
      loadCurrentStatus()
      loadTodayStats()
      loadTodayTasks()
    }, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [cleanerId])

  const loadCleanerData = async () => {
    const { data, error } = await supabase
      .from('uk_cleaners')
      .select('*')
      .eq('cleaner_id', cleanerId)
      .single()

    if (!error && data) {
      setCleaner(data)
    }
  }

  const loadCurrentStatus = async () => {
    const { data, error } = await supabase
      .from('uk_cleaner_live_tracking')
      .select('*')
      .eq('cleaner_id', cleanerId)
      .eq('is_active', true)
      .order('timestamp', { ascending: false })
      .limit(1)

    if (!error && data && data.length > 0) {
      setCurrentStatus(data[0])
    } else {
      setCurrentStatus(null)
    }
  }


  const loadTodayStats = async () => {
    const today = new Date().toISOString().split('T')[0]
    
    const { data, error } = await supabase
      .from('uk_cleaner_logs')
      .select('*')
      .eq('cleaner_id', cleanerId)
      .gte('timestamp', `${today}T00:00:00.000Z`)
      .lt('timestamp', `${today}T23:59:59.999Z`)

    if (!error && data) {
      const scans = data.length
      const clockIns = data.filter(log => log.action === 'Clock In').length
      const areas = new Set(data.map(log => log.site_area).filter(Boolean)).size
      
      // Calculate work duration (simple estimation)
      const clockInTime = data.find(log => log.action === 'Clock In')?.timestamp
      const clockOutTime = data.find(log => log.action === 'Clock Out')?.timestamp
      let duration = 0
      
      if (clockInTime && clockOutTime) {
        duration = Math.round((new Date(clockOutTime).getTime() - new Date(clockInTime).getTime()) / (1000 * 60 * 60))
      } else if (clockInTime && !clockOutTime) {
        duration = Math.round((new Date().getTime() - new Date(clockInTime).getTime()) / (1000 * 60 * 60))
      }

      // Get task stats (will be updated when loadTodayTasks is called)
      const currentTasks = await QRService.getTaskSelections(cleanerId, today)
      const tasksSelected = currentTasks.reduce((sum, selection) => sum + selection.selectedTasks.length, 0)
      const tasksCompleted = currentTasks.reduce((sum, selection) => sum + (selection.completedTasks?.length || 0), 0)

      setTodayStats({ scans, clockIns, areas, duration, tasksSelected, tasksCompleted })
    }
    
    setLoading(false)
  }

  const loadTodayTasks = async () => {
    const today = new Date().toISOString().split('T')[0]
    const selections = await QRService.getTaskSelections(cleanerId, today)
    setTaskSelections(selections)
  }

  const loadWeeklyData = async () => {
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const weeklyStats = []

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      const { data, error } = await supabase
        .from('uk_cleaner_logs')
        .select('*')
        .eq('cleaner_id', cleanerId)
        .gte('timestamp', `${dateStr}T00:00:00.000Z`)
        .lt('timestamp', `${dateStr}T23:59:59.999Z`)

      if (!error && data) {
        weeklyStats.push({
          day: weekDays[date.getDay() === 0 ? 6 : date.getDay() - 1],
          scans: data.length,
          clockIns: data.filter(log => log.action.includes('Clock In')).length,
          areas: new Set(data.map(log => log.site_area).filter(Boolean)).size
        })
      }
    }

    setWeeklyData(weeklyStats)

    // Activity breakdown
    const activityBreakdown = [
      { name: 'QR Scans', value: todayStats.scans, color: '#3b82f6' },
      { name: 'Clock Ins', value: todayStats.clockIns, color: '#10b981' },
      { name: 'Areas', value: todayStats.areas, color: '#6366f1' }
    ]
    setActivityData(activityBreakdown)
  }


  const getStatusColor = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case 'clock_in': return 'bg-green-500'
      case 'clock_out': return 'bg-red-500'
      case 'area_scan': return 'bg-blue-500'
      case 'task_started': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  const formatDuration = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}m`
    return `${hours.toFixed(1)}h`
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <Tabs defaultValue="overview" className="space-y-8">
        <TabsList className="w-full justify-start space-x-2 bg-white shadow-lg rounded-3xl p-2">
          <TabsTrigger value="overview" className="rounded-2xl px-6 py-2 text-sm font-semibold">Overview</TabsTrigger>
          <TabsTrigger value="assist" className="rounded-2xl px-6 py-2 text-sm font-semibold">Bathroom Assist</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-8">
          {/* Header */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl lg:text-4xl font-bold" style={{ color: '#00339B' }}>
              Welcome, {cleanerName}
            </h1>
            <p className="text-gray-600 text-lg">Your Cleaning Dashboard</p>
          </div>

          {/* Current Status */}
          <Card className="card-modern border-0 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl font-semibold">
                <div className="p-2 rounded-xl" style={{ backgroundColor: '#e6eefc' }}>
                  <Clock className="h-6 w-6" style={{ color: '#00339B' }} />
                </div>
                Current Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentStatus ? (
                <div className="flex items-center gap-4">
                  <Badge className={`${getStatusColor(currentStatus.event_type)} text-white px-3 py-1 rounded-full text-sm font-medium`}>
                    {currentStatus.event_type?.replace('_', ' ').toUpperCase() || 'ACTIVE'}
                  </Badge>
                  <div>
                    <p className="font-medium text-gray-900">{currentStatus.site_area || 'Unknown Location'}</p>
                    <p className="text-sm text-gray-600">
                      Since {new Date(currentStatus.clock_in_time || '').toLocaleTimeString()}
                    </p>
                  </div>
                  {currentStatus.latitude && currentStatus.longitude && (
                    <div className="flex items-center gap-1 text-sm text-green-600">
                      <MapPin className="h-4 w-4" />
                      Location Tracked
                    </div>
                  )}
                </div>
              ) : (
                <Alert className="border-blue-200 bg-blue-50">
                  <AlertCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    No active session. Scan a Clock-In QR code to start.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Today's Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 lg:gap-6">
            <Card className="card-modern border-0 shadow-xl hover:scale-105 transition-all duration-200 cursor-pointer group">
              <CardContent className="p-4 lg:p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center group-hover:shadow-lg transition-shadow" style={{ backgroundColor: '#00339B' }}>
                  <QrCode className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold mb-1" style={{ color: '#00339B' }}>{todayStats.scans}</div>
                <div className="text-xs lg:text-sm text-gray-600 font-medium">QR Scans</div>
              </CardContent>
            </Card>
            <Card className="card-modern border-0 shadow-xl hover:scale-105 transition-all duration-200 cursor-pointer group">
              <CardContent className="p-4 lg:p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-green-600 flex items-center justify-center group-hover:shadow-lg transition-shadow">
                  <CheckCircle2 className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold text-green-600 mb-1">{todayStats.clockIns}</div>
                <div className="text-xs lg:text-sm text-gray-600 font-medium">Clock Ins</div>
              </CardContent>
            </Card>
            <Card className="card-modern border-0 shadow-xl hover:scale-105 transition-all duration-200 cursor-pointer group">
              <CardContent className="p-4 lg:p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-indigo-600 flex items-center justify-center group-hover:shadow-lg transition-shadow">
                  <MapPin className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold text-indigo-600 mb-1">{todayStats.areas}</div>
                <div className="text-xs lg:text-sm text-gray-600 font-medium">Areas</div>
              </CardContent>
            </Card>
            <Card className="card-modern border-0 shadow-xl hover:scale-105 transition-all duration-200 cursor-pointer group">
              <CardContent className="p-4 lg:p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-orange-600 flex items-center justify-center group-hover:shadow-lg transition-shadow">
                  <ListTodo className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold text-orange-600 mb-1">{todayStats.tasksSelected}</div>
                <div className="text-xs lg:text-sm text-gray-600 font-medium">Tasks Selected</div>
              </CardContent>
            </Card>
            <Card className="card-modern border-0 shadow-xl hover:scale-105 transition-all duration-200 cursor-pointer group">
              <CardContent className="p-4 lg:p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-emerald-600 flex items-center justify-center group-hover:shadow-lg transition-shadow">
                  <ClipboardCheck className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold text-emerald-600 mb-1">{todayStats.tasksCompleted}</div>
                <div className="text-xs lg:text-sm text-gray-600 font-medium">Tasks Done</div>
              </CardContent>
            </Card>
            <Card className="card-modern border-0 shadow-xl hover:scale-105 transition-all duration-200 cursor-pointer group">
              <CardContent className="p-4 lg:p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-slate-600 flex items-center justify-center group-hover:shadow-lg transition-shadow">
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold text-slate-600 mb-1">
                  {formatDuration(todayStats.duration)}
                </div>
                <div className="text-xs lg:text-sm text-gray-600 font-medium">Duration</div>
              </CardContent>
            </Card>
          </div>

          {/* Analytics Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Weekly Activity Chart */}
            <Card className="card-modern border-0 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl font-semibold">
                  <div className="p-2 rounded-xl" style={{ backgroundColor: '#e6eefc' }}>
                    <BarChart3 className="h-6 w-6" style={{ color: '#00339B' }} />
                  </div>
                  Weekly Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ChartContainer
                    config={{
                      scans: {
                        label: "QR Scans",
                        color: "#3b82f6",
                      },
                      clockIns: {
                        label: "Clock Ins",
                        color: "#10b981",
                      },
                      areas: {
                        label: "Areas",
                        color: "#6366f1",
                      },
                    }}
                  >
                    <BarChart data={weeklyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="scans" fill="#00339B" name="QR Scans" />
                      <Bar dataKey="clockIns" fill="#10b981" name="Clock Ins" />
                      <Bar dataKey="areas" fill="#6366f1" name="Areas" />
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            {/* Activity Breakdown */}
            <Card className="card-modern border-0 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl font-semibold">
                  <div className="p-2 rounded-xl bg-green-100">
                    <QrCode className="h-6 w-6 text-green-600" />
                  </div>
                  Today's Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ChartContainer
                    config={{
                      scans: {
                        label: "QR Scans",
                        color: "#3b82f6",
                      },
                      clockIns: {
                        label: "Clock Ins", 
                        color: "#10b981",
                      },
                      areas: {
                        label: "Areas",
                        color: "#6366f1",
                      },
                    }}
                  >
                    <PieChart>
                      <Pie
                        data={activityData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {activityData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                    </PieChart>
                  </ChartContainer>
                </div>
                {/* Legend */}
                <div className="flex justify-center gap-4 mt-4">
                  {activityData.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-sm text-gray-600">{item.name}: {item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="assist">
          <BathroomAssistPanel cleanerId={cleanerId} cleanerName={cleanerName} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
