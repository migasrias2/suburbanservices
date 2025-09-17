import React, { useState } from 'react'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import ProgressIndicator from '@/components/ui/progress-indicator'
import { QRScanner } from '@/components/qr/QRScanner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Camera, CheckCircle2, QrCode, Upload, Image as ImageIcon } from 'lucide-react'

type Step = 1 | 2 | 3

export default function ClockInPage() {
  const [step, setStep] = useState<Step>(1)
  const [areaScanned, setAreaScanned] = useState(false)
  const [tasksChecked, setTasksChecked] = useState<{ [k: string]: boolean }>({})
  const [photosCount, setPhotosCount] = useState(0)
  const userName = localStorage.getItem('userName') || 'Cleaner'
  const userType = (localStorage.getItem('userType') as 'cleaner' | 'manager' | 'admin') || 'cleaner'

  const next = () => setStep((s) => (s < 3 ? ((s + 1) as Step) : s))
  const back = () => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold" style={{ color: '#00339B' }}>Clock In</h1>
          <p className="text-sm text-gray-500">Scan → Complete tasks → Upload photos → Submit</p>
        </div>

        {/* Top wizard controls removed; embed below content and drive step via buttons */}

        {step === 1 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-4 w-4" style={{ color: '#00339B' }} /> Scan Area QR Code</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <QRScanner
                cleanerId={localStorage.getItem('userId') || ''}
                cleanerName={userName}
                onScanSuccess={() => setAreaScanned(true)}
                onScanError={() => setAreaScanned(false)}
              />
              <div className="flex justify-between items-center">
                <ProgressIndicator step={1} showControls={false} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={back}>Back</Button>
                  <Button onClick={next} disabled={!areaScanned} style={{ backgroundColor: '#00339B', color: '#fff' }}>Continue</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-green-600" /> Complete Tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {['Mop Floors', 'Replace Toilet Paper', 'Hand Towels', 'Hand Soap', 'Sanitize Surfaces'].map((t, i) => (
                <label key={t} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={!!tasksChecked[t]}
                    onChange={(e) => setTasksChecked((s) => ({ ...s, [t]: e.target.checked }))}
                  />
                  <span>{i + 1}. {t}</span>
                </label>
              ))}
              <div className="flex justify-between items-center pt-2">
                <ProgressIndicator step={2} showControls={false} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={back}>Back</Button>
                  <Button onClick={next} disabled={Object.keys(tasksChecked).length === 0} style={{ backgroundColor: '#00339B', color: '#fff' }}>Continue</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" style={{ color: '#00339B' }} /> Upload Photos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map((i) => (
                  <label key={i} className="aspect-square rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400 cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={() => setPhotosCount((c) => c + 1)} />
                    <ImageIcon className="h-5 w-5" />
                  </label>
                ))}
              </div>
              <div className="flex justify-between items-center">
                <ProgressIndicator step={3} showControls={false} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={back}>Back</Button>
                  <Button disabled={photosCount === 0} style={{ backgroundColor: '#00339B', color: '#fff' }}>Finish</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Sidebar07Layout>
  )
}


