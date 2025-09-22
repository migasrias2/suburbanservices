import React, { useState, useEffect } from 'react'
import { Clock, QrCode, CheckCircle2, ArrowLeft, MapPin, Camera, User, Calendar } from 'lucide-react'
import { QRScanner } from './QRScanner'
import { TaskSelector } from './TaskSelector'
import { ClockOutValidator } from './ClockOutValidator'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { QRCodeData } from '../../services/qrService'

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
      setCurrentStep('tasks')
    }
  }

  const handleTasksCompleted = () => {
    if (currentAreaData) {
      const newCompletedArea: CompletedArea = {
        qrData: currentAreaData,
        completedAt: new Date().toISOString(),
        tasksCount: 0 // This would be updated with actual task count
      }
      setCompletedAreas(prev => [...prev, newCompletedArea])
      setCurrentAreaData(null)
      // Go back to welcome page after task completion
      setCurrentStep('welcome')
    }
  }

  const handleClockOutStart = () => {
    setCurrentStep('clock_out')
  }

  const handleClockOutSuccess = () => {
    onClockOut?.()
  }

  const handleScanAnotherArea = () => {
    setCurrentStep('area_scan')
  }

  const handleBackToTasks = () => {
    if (currentAreaData) {
      setCurrentStep('tasks')
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
              {siteName && (
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <MapPin className="w-6 h-6" style={{ color: '#00339B' }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Location</p>
                    <p className="text-lg font-semibold" style={{ color: '#00339B' }}>{siteName}</p>
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
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Areas completed:</span>
                  <span className="font-semibold" style={{ color: '#00339B' }}>{completedAreas.length}</span>
                </div>
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
