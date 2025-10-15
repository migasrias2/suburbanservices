import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { QRGenerator } from '@/components/qr/QRGenerator'
import { QRScanner } from '@/components/qr/QRScanner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { getStoredCleanerName } from '@/lib/identity'
import { QRCodeData, ManualQRCodeResult } from '@/services/qrService'

const ADMIN_PLACEHOLDER_ID = 'admin-preview'

export default function QRGeneratorPage() {
  const navigate = useNavigate()
  const [userType, setUserType] = useState<'admin' | null>(null)
  const [userId, setUserId] = useState<string>('')
  const [userName, setUserName] = useState<string>('')
  const [lastScan, setLastScan] = useState<QRCodeData | null>(null)
  const [lastCreated, setLastCreated] = useState<ManualQRCodeResult | null>(null)

  useEffect(() => {
    const storedType = localStorage.getItem('userType')
    const storedId = localStorage.getItem('userId')
    const storedName = getStoredCleanerName()

    if (storedType !== 'admin' || !storedId || !storedName) {
      navigate('/login')
      return
    }

    setUserType('admin')
    setUserId(storedId)
    setUserName(storedName)
  }, [navigate])

  if (!userType || !userId || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900 sm:text-4xl">QR Code Generator</h1>
            <p className="text-gray-600">Create new customer area codes and test them instantly.</p>
          </div>
          {lastCreated && (
            <Button
              onClick={() => navigate('/qr-library')}
              className="rounded-full bg-[#00339B] px-6 text-white shadow-md"
            >
              View in Library
            </Button>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <QRGenerator onGenerated={(result) => {
            setLastCreated(result)
            setLastScan(result.qrData)
          }} />

          <Card className="border-0 shadow-xl rounded-3xl">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl font-semibold text-gray-900">
                Test a QR Code
              </CardTitle>
              <p className="text-sm text-gray-600">
                Use the camera to scan and preview how the QR behaves in the cleaner workflow. Preview mode skips database logging.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <QRScanner
                cleanerId={userId || ADMIN_PLACEHOLDER_ID}
                cleanerName={userName}
                previewMode
                allowedTypes={['CLOCK_IN', 'CLOCK_OUT', 'AREA', 'TASK', 'FEEDBACK']}
                onScanSuccess={(data) => setLastScan(data)}
                onScanError={() => setLastScan(null)}
              />

              <Separator className="bg-gray-100" />

              {lastScan ? (
                <div className="space-y-4">
                  <Alert className="rounded-2xl border-green-200 bg-green-50">
                    <AlertDescription>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Badge className="rounded-full bg-green-600 text-white">{lastScan.type}</Badge>
                          <span className="text-sm font-semibold text-green-900">Scan successful</span>
                        </div>
                        <div className="grid gap-2 text-sm text-green-800">
                          {lastScan.customerName && <p><strong>Customer:</strong> {lastScan.customerName}</p>}
                          {lastScan.metadata?.siteName && <p><strong>Site:</strong> {lastScan.metadata.siteName}</p>}
                          {lastScan.metadata?.areaName && <p><strong>Area:</strong> {lastScan.metadata.areaName}</p>}
                          {lastScan.metadata?.floor && <p><strong>Floor:</strong> {lastScan.metadata.floor}</p>}
                          {lastScan.metadata?.category && <p><strong>Category:</strong> {lastScan.metadata.category}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="self-start rounded-full border-gray-200"
                          onClick={() => setLastScan(null)}
                        >
                          Clear Result
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <Alert className="rounded-2xl border-blue-100 bg-blue-50">
                  <AlertDescription className="text-sm text-blue-800">
                    Align a QR within the scanner frame to preview its payload before rolling it out to cleaners.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Sidebar07Layout>
  )
}
