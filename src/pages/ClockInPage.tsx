import React, { useState } from 'react'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { QRScanner } from '@/components/qr/QRScanner'
import { WorkflowManager } from '@/components/qr/WorkflowManager'
import { Button } from '@/components/ui/button'
import { Clock, QrCode } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

type Phase = 'clock_in' | 'workflow' | 'completed'

export default function ClockInPage() {
  const userName = localStorage.getItem('userName') || 'Cleaner'
  const userType = (localStorage.getItem('userType') as 'cleaner' | 'manager' | 'admin') || 'cleaner'
  const cleanerId = localStorage.getItem('userId') || ''
  const navigate = useNavigate()

  // Initialize state from localStorage to persist across refreshes
  const [currentPhase, setCurrentPhase] = useState<Phase>(() => {
    const savedPhase = localStorage.getItem('currentClockInPhase')
    return (savedPhase as Phase) || 'clock_in'
  })
  
  const [showScanner, setShowScanner] = useState(false)
  
  const [clockInData, setClockInData] = useState<{
    time: string
    siteName?: string
  } | null>(() => {
    const saved = localStorage.getItem('currentClockInData')
    return saved ? JSON.parse(saved) : null
  })

  const handleClockInSuccess = (qrData: any) => {
    // Store clock-in information
    const clockInInfo = {
      time: new Date().toISOString(),
      siteName: qrData?.metadata?.siteName || qrData?.customerName || 'Work Site'
    }
    setClockInData(clockInInfo)
    setCurrentPhase('workflow')
    
    // Persist to localStorage
    localStorage.setItem('currentClockInData', JSON.stringify(clockInInfo))
    localStorage.setItem('currentClockInPhase', 'workflow')
  }

  const handleClockOut = () => {
    // Handle successful clock out
    setCurrentPhase('completed')
    
    // Clear persisted clock-in state
    localStorage.removeItem('currentClockInData')
    localStorage.removeItem('currentClockInPhase')
    
    setTimeout(() => {
      navigate('/login')
    }, 2000)
  }

  const handleBackToClockIn = () => {
    setCurrentPhase('clock_in')
    setShowScanner(false)
    setClockInData(null)
    
    // Clear persisted state when going back to clock-in
    localStorage.removeItem('currentClockInData')
    localStorage.removeItem('currentClockInPhase')
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="max-w-4xl mx-auto py-8">
        
        {/* Clock-in Phase */}
        {currentPhase === 'clock_in' && (
          <div className="flex flex-col items-center text-center gap-8">
            {/* Header */}
            <div className="space-y-4">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
                <Clock className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-4xl font-bold" style={{ color: '#00339B' }}>
                Clock In
              </h1>
              <p className="text-lg text-gray-600 max-w-md">
                To begin your shift, scan the Clock In QR code at your work location
              </p>
            </div>

            {/* Clock-in Scanner */}
            {!showScanner ? (
              <div className="space-y-6">
                <div className="p-6 bg-blue-50 rounded-3xl max-w-md mx-auto">
                  <div className="flex items-center justify-center gap-3 text-blue-800">
                    <QrCode className="w-6 h-6" />
                    <span className="text-lg font-medium">Ready to scan</span>
                  </div>
                </div>
                <Button
                  onClick={() => setShowScanner(true)}
                  className="rounded-full px-12 py-6 text-lg font-semibold text-white shadow-lg transition-all duration-200"
                  style={{ backgroundColor: '#00339B' }}
                >
                  <QrCode className="w-6 h-6 mr-3" />
                  Start Clock In
                </Button>
              </div>
            ) : (
              <div className="w-full max-w-md">
                <QRScanner
                  cleanerId={cleanerId}
                  cleanerName={userName}
                  onScanSuccess={handleClockInSuccess}
                  onScanError={() => {}}
                  allowedTypes={["CLOCK_IN"]}
                />
                <div className="mt-4 text-center">
                  <Button 
                    variant="ghost" 
                    onClick={() => setShowScanner(false)}
                    className="text-gray-500 rounded-full"
                  >
                    Cancel Scanning
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Workflow Phase */}
        {currentPhase === 'workflow' && clockInData && (
          <WorkflowManager
            cleanerId={cleanerId}
            cleanerName={userName}
            clockInTime={clockInData.time}
            siteName={clockInData.siteName}
            onClockOut={handleClockOut}
            onBack={handleBackToClockIn}
          />
        )}

        {/* Completion Phase */}
        {currentPhase === 'completed' && (
          <div className="flex flex-col items-center text-center gap-8">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center shadow-lg animate-pulse">
              <Clock className="w-10 h-10 text-white" />
            </div>
            <div className="space-y-4">
              <h1 className="text-3xl font-bold text-gray-900">
                Successfully Clocked Out!
              </h1>
              <p className="text-lg text-gray-600">
                Thank you for your hard work today, {userName}
              </p>
              <div className="text-sm text-gray-500">
                Redirecting to dashboard...
              </div>
            </div>
          </div>
        )}
      </div>
    </Sidebar07Layout>
  )
}


