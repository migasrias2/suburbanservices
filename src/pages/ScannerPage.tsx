import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { QRScanner } from '../components/qr/QRScanner'
import { QRService, QRCodeData } from '../services/qrService'
import { Card, CardContent } from '../components/ui/card'
import { Camera } from 'lucide-react'
import { getStoredCleanerName } from '../lib/identity'

export default function ScannerPage() {
  const navigate = useNavigate()
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

  const handleScanSuccess = (qrData: QRCodeData) => {
    console.log('Scan successful:', qrData)
    // Could show a success toast or redirect
  }

  const handleScanError = (error: string) => {
    console.error('Scan error:', error)
    // Could show an error toast
  }

  return (
    <Sidebar07Layout userType={(userType || 'cleaner') as 'cleaner' | 'manager' | 'ops_manager' | 'admin'} userName={userName}>
      <div className="space-y-8 max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="p-4 rounded-2xl bg-primary/10">
                <Camera className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-primary">
              QR Code Scanner
            </h1>
            <p className="text-muted-foreground text-lg">Scan QR codes to track your cleaning activities</p>
          </div>

          {/* Scanner Card */}
          <Card className="card-modern border-0 shadow-xl">
            <CardContent className="p-8">
              <div className="text-center">
                <QRScanner
                  cleanerId={userId}
                  cleanerName={userName}
                  onScanSuccess={handleScanSuccess}
                  onScanError={handleScanError}
                />
              </div>
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card className="card-modern border-0 shadow-lg">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">How to Scan</h3>
              <div className="space-y-3 text-muted-foreground">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-primary text-sm font-medium">1</span>
                  </div>
                  <p>Position the QR code within the scanner frame</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-primary text-sm font-medium">2</span>
                  </div>
                  <p>Keep your device steady until the code is detected</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-primary text-sm font-medium">3</span>
                  </div>
                  <p>Wait for confirmation that your activity has been logged</p>
                </div>
              </div>
            </CardContent>
          </Card>
      </div>
    </Sidebar07Layout>
  )
}
