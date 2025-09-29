import React, { useState, useEffect, useCallback } from 'react'
import { Clock, QrCode, CheckCircle2, ArrowLeft, MapPin, Calendar } from 'lucide-react'
import { QRScanner } from './QRScanner'
import { TaskSelector, TaskSubmissionSummary } from './TaskSelector'
import { ClockOutValidator } from './ClockOutValidator'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { QRCodeData } from '../../services/qrService'
import { QRService } from '../../services/qrService'
import { getDraft as getLocalDraft } from '../../lib/offlineStore'

type WorkflowStep = 
  | 'welcome' 
  | 'area_scan' 
  | 'tasks' 
  | 'next_action'
  | 'clock_out'

interface WorkflowManagerProps {
  cleanerId: string
  cleanerName: string
  clockInTime?: string
  siteName?: string
  onClockOut?: () => void
  onBack?: () => void
}

interface CompletedArea {
  qrData: QRCodeData
  completedAt: string
  tasksCount: number
  areaName?: string
}

export const WorkflowManager: React.FC<WorkflowManagerProps> = ({
  cleanerId,
  cleanerName,
  clockInTime,
  siteName,
  onClockOut,
  onBack
}) => {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('welcome')
  const [currentAreaData, setCurrentAreaData] = useState<QRCodeData | null>(null)
  const [completedAreas, setCompletedAreas] = useState<CompletedArea[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [initialTaskState, setInitialTaskState] = useState<any | null>(null)
  const getStoredSiteName = useCallback(() => {
    if (typeof window === 'undefined') return undefined
    return localStorage.getItem('currentSiteName') || undefined
  }, [])
  const [persistentSiteName, setPersistentSiteName] = useState<string | undefined>(() => siteName || (typeof window !== 'undefined' ? localStorage.getItem('currentSiteName') || undefined : undefined))
  const [lastCompletedAreaName, setLastCompletedAreaName] = useState<string | undefined>(undefined)
  const [lastCompletedTaskCount, setLastCompletedTaskCount] = useState<number>(0)

  const persistSiteName = useCallback((name: string) => {
    setPersistentSiteName(name)
    if (typeof window !== 'undefined') {
      localStorage.setItem('currentSiteName', name)
    }
  }, [])

  useEffect(() => {
    if (siteName && siteName !== persistentSiteName) {
      persistSiteName(siteName)
    } else if (!persistentSiteName) {
      const stored = getStoredSiteName()
      if (stored) {
        setPersistentSiteName(stored)
      }
    }
  }, [siteName, persistentSiteName, persistSiteName, getStoredSiteName])

  // Format the current time for display
  const getCurrentTime = () => {
    return new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    })
  }

  // Format clock-in time
  const getClockInTime = () => {
    if (clockInTime) {
      return new Date(clockInTime).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      })
    }
    return getCurrentTime()
  }

  const handleAreaScan = (qrData: QRCodeData) => {
    if (qrData.type === 'AREA') {
      setCurrentAreaData(qrData)
      if (qrData.customerName) {
        persistSiteName(qrData.customerName)
      }
      if (qrData.metadata?.siteName) {
        persistSiteName(qrData.metadata.siteName)
      }
      setCurrentStep('tasks')
    }
  }

  // On mount, try to resume from remote draft (fallback to local)
  useEffect(() => {
    const cleanerId = localStorage.getItem('userId') || ''
    const resume = async () => {
      setIsLoading(true)
      try {
        const remote = await QRService.fetchRemoteDraft(cleanerId)
        const local = await getLocalDraft()
        // Prefer local draft with photos if present. Otherwise merge remote+local when same qr.
        let chosen: any = null
        const localHasPhotos = !!local?.state?.taskCompletions?.some((tc: any) => (tc.photos?.length || 0) > 0)
        if (localHasPhotos) {
          chosen = local
        } else if (remote) {
          // Try to merge photos from local when both refer to the same QR
          if (local && (local.qrCodeId === remote.qr_code_id)) {
            chosen = {
              ...remote,
              qrCodeId: remote.qr_code_id,
              state: {
                ...(remote.state || {}),
                qrData: remote.state?.qrData || local.state?.qrData,
                taskCompletions: local.state?.taskCompletions || [],
                confirmedPhotos: remote.state?.confirmedPhotos || local.state?.confirmedPhotos || {}
              },
              currentTaskIndex: remote.current_task_index ?? local.currentTaskIndex ?? 0
            }
          } else {
            chosen = { ...remote, qrCodeId: remote.qr_code_id }
          }
        } else if (local) {
          chosen = local
        }

        if (chosen && chosen.step === 'tasks' && chosen.state?.qrData) {
          setCurrentAreaData(chosen.state.qrData)
          setCurrentStep('tasks')
          setInitialTaskState({
            currentTaskIndex: chosen.current_task_index ?? chosen.currentTaskIndex ?? 0,
            taskCompletions: chosen.state.taskCompletions || [],
            confirmedPhotos: chosen.state.confirmedPhotos || {}
          })
        }
      } catch {}
      setIsLoading(false)
    }
    resume()
  }, [])

  const handleTasksCompleted = (summary?: TaskSubmissionSummary) => {
    if (currentAreaData) {
      const newCompletedArea: CompletedArea = {
        qrData: currentAreaData,
        completedAt: new Date().toISOString(),
        tasksCount: summary?.taskCount ?? 0,
        areaName: summary?.areaName || currentAreaData.metadata?.areaName
      }
      setCompletedAreas(prev => [...prev, newCompletedArea])
      setCurrentAreaData(null)
      setLastCompletedAreaName(summary?.areaName || currentAreaData.metadata?.areaName)
      setLastCompletedTaskCount(summary?.taskCount ?? 0)
      setCurrentStep('next_action')
    }
  }

  const handleClockOutStart = () => {
    setCurrentStep('clock_out')
  }

  const handleClockOutSuccess = () => {
    onClockOut?.()
  }

  const handleScanAnotherArea = () => {
    setCurrentAreaData(null)
    setLastCompletedAreaName(undefined)
    setLastCompletedTaskCount(0)
    setCurrentStep('area_scan')
  }

  const handleBackToTasks = () => {
    if (currentAreaData) {
      setCurrentStep('tasks')
    } else {
      setCurrentStep('area_scan')
    }
  }

  // Welcome Screen
  if (currentStep === 'welcome') {
    return (
      <div className="w-full max-w-lg mx-auto space-y-6">
        {/* Welcome Header */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {cleanerName}!
            </h1>
            <p className="text-gray-600">You're successfully clocked in</p>
          </div>
        </div>

        {/* Clock-in Info Card */}
        <Card className="rounded-3xl border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-6">
            <div className="space-y-4">
              {/* Clock-in Time */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6" style={{ color: '#00339B' }} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Clocked in at</p>
                  <p className="text-xl font-bold" style={{ color: '#00339B' }}>
                    {getClockInTime()}
                  </p>
                </div>
              </div>

              {/* Site Info */}
              {(persistentSiteName || siteName) && (
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <MapPin className="w-6 h-6" style={{ color: '#00339B' }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Location</p>
                    <p className="text-lg font-semibold" style={{ color: '#00339B' }}>{persistentSiteName || siteName}</p>
                  </div>
                </div>
              )}

              {/* Current Date */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Calendar className="w-6 h-6" style={{ color: '#00339B' }} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Date</p>
                  <p className="text-lg font-semibold" style={{ color: '#00339B' }}>
                    {new Date().toLocaleDateString('en-US', { 
                      weekday: 'long',
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Step Card */}
        <Card className="rounded-3xl border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                <QrCode className="w-8 h-8" style={{ color: '#00339B' }} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-gray-900">Ready to Start</h3>
                <p className="text-gray-600">
                  Scan the Area QR code to begin your cleaning tasks
                </p>
              </div>
              <Button
                onClick={() => setCurrentStep('area_scan')}
                className="w-full rounded-full py-4 text-lg font-semibold text-white shadow-lg transition-all duration-200"
                style={{ backgroundColor: '#00339B' }}
              >
                <QrCode className="w-5 h-5 mr-3" />
                Scan Area QR Code
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Back Button */}
        {onBack && (
          <div className="text-center">
            <Button variant="ghost" onClick={onBack} className="text-gray-500 rounded-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
        )}
      </div>
    )
  }

  // Area QR Scan Step
  if (currentStep === 'area_scan') {
    return (
      <div className="w-full max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
            <QrCode className="w-8 h-8" style={{ color: '#00339B' }} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">Scan Area QR Code</h1>
            <p className="text-gray-600">
              Point your camera at the QR code to start cleaning this area
            </p>
          </div>
        </div>

        {/* Completed Areas Summary */}
        {completedAreas.length > 0 && (
          <Card className="rounded-2xl border-0 shadow-sm bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5" style={{ color: '#00339B' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: '#00339B' }}>
                    Areas completed: {completedAreas.length}
                  </p>
                  <p className="text-xs text-blue-700">
                    Great work so far!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* QR Scanner */}
        <div className="space-y-4">
          <QRScanner
            cleanerId={cleanerId}
            cleanerName={cleanerName}
            onScanSuccess={handleAreaScan}
            allowedTypes={['AREA']}
          />
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setCurrentStep('welcome')}
            className="flex-1 rounded-full py-3 border-blue-200 hover:bg-blue-50"
            style={{ color: '#00339B' }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Welcome
          </Button>
          
          <Button
            variant="outline"
            onClick={handleClockOutStart}
            className="flex-1 rounded-full py-3 text-red-600 border-red-200 hover:bg-red-50"
          >
            <Clock className="w-4 h-4 mr-2" />
            Clock Out
          </Button>
        </div>
      </div>
    )
  }

  // Task Management Step
  if (currentStep === 'tasks' && currentAreaData) {
    return (
      <div className="w-full space-y-4">
        <TaskSelector
          qrData={currentAreaData}
          cleanerId={cleanerId}
          cleanerName={cleanerName}
          initialState={initialTaskState || undefined}
          onWorkSubmitted={handleTasksCompleted}
          onClockOut={handleClockOutStart}
          onCancel={() => setCurrentStep('area_scan')}
        />
      </div>
    )
  }

  // Next Action Step
  if (currentStep === 'next_action') {
    return (
      <div className="w-full max-w-lg mx-auto space-y-6">
        {/* Success Header */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold" style={{ color: '#00339B' }}>Task Complete!</h1>
            <p className="text-gray-600">
              Great work! All photos have been uploaded successfully.
            </p>
          </div>
        </div>

        {/* Summary Card */}
        <Card className="rounded-3xl border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="text-center">
                <Badge className="text-white px-4 py-2 text-sm rounded-full" style={{ backgroundColor: '#00339B' }}>
                  ✓ COMPLETED
                </Badge>
              </div>
              
              <div className="space-y-3">
                {lastCompletedAreaName && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Last area:</span>
                    <span className="font-semibold" style={{ color: '#00339B' }}>{lastCompletedAreaName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Areas completed:</span>
                  <span className="font-semibold" style={{ color: '#00339B' }}>{completedAreas.length}</span>
                </div>
                {lastCompletedTaskCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Tasks submitted:</span>
                    <span className="font-semibold" style={{ color: '#00339B' }}>{lastCompletedTaskCount}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Time:</span>
                  <span className="font-semibold" style={{ color: '#00339B' }}>{getCurrentTime()}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Options */}
        <Card className="rounded-3xl border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-center text-lg">What's next?</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <Button
              onClick={handleScanAnotherArea}
              className="w-full rounded-full py-4 text-lg font-semibold text-white shadow-lg transition-all duration-200"
              style={{ backgroundColor: '#00339B' }}
            >
              <QrCode className="w-5 h-5 mr-3" />
              Scan Another Area
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-gray-500">or</span>
              </div>
            </div>

            <Button
              onClick={handleClockOutStart}
              variant="outline"
              className="w-full rounded-full py-4 text-lg font-semibold text-red-600 border-red-200 hover:bg-red-50"
            >
              <Clock className="w-5 h-5 mr-3" />
              Finish Shift & Clock Out
            </Button>
          </CardContent>
        </Card>

        {/* Back to Tasks */}
        <div className="text-center">
          <Button 
            variant="ghost" 
            onClick={handleBackToTasks}
            className="text-gray-500 rounded-full"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Tasks
          </Button>
        </div>
      </div>
    )
  }

  // Clock Out Step
  if (currentStep === 'clock_out') {
    return (
      <div className="w-full space-y-4">
        <ClockOutValidator
          cleanerId={cleanerId}
          cleanerName={cleanerName}
          onClockOutSuccess={handleClockOutSuccess}
          onCancel={() => setCurrentStep('next_action')}
        />
      </div>
    )
  }

  // Default fallback
  return (
    <div className="text-center space-y-4">
      <p className="text-gray-600">Loading workflow...</p>
    </div>
  )
}
