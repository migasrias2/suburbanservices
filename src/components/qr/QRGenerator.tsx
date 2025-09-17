import React, { useState, useEffect } from 'react'
import { QrCode, Download, Copy, CheckCircle2 } from 'lucide-react'
import { QRService, QRCodeData } from '../../services/qrService'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { supabase, UKSite, Area } from '../../services/supabase'

interface QRGeneratorProps {
  onQRGenerated?: (qrData: QRCodeData, qrImage: string) => void
}

export const QRGenerator: React.FC<QRGeneratorProps> = ({ onQRGenerated }) => {
  const [qrType, setQrType] = useState<QRCodeData['type']>('CLOCK_IN')
  const [sites, setSites] = useState<UKSite[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [selectedArea, setSelectedArea] = useState<string>('')
  const [customText, setCustomText] = useState<string>('')
  const [generatedQR, setGeneratedQR] = useState<string | null>(null)
  const [lastGenerated, setLastGenerated] = useState<QRCodeData | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadSites()
    loadAreas()
  }, [])

  const loadSites = async () => {
    const { data, error } = await supabase
      .from('uk_sites')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (!error && data) {
      setSites(data)
    }
  }

  const loadAreas = async () => {
    const { data, error } = await supabase
      .from('areas')
      .select('*')
      .order('area')

    if (!error && data) {
      setAreas(data)
    }
  }

  const generateQR = async () => {
    if (!selectedSite && (qrType === 'CLOCK_IN' || qrType === 'CLOCK_OUT')) {
      alert('Please select a site')
      return
    }

    if (!selectedArea && qrType === 'AREA') {
      alert('Please select an area')
      return
    }

    setIsGenerating(true)

    try {
      let qrImage: string
      let qrData: QRCodeData

      const selectedSiteData = sites.find(s => s.site_id === selectedSite)
      const selectedAreaData = areas.find(a => a.id === selectedArea)

      switch (qrType) {
        case 'CLOCK_IN':
          qrImage = await QRService.generateClockInQR(
            selectedSite,
            selectedSiteData?.customer_name || 'Unknown Customer'
          )
          qrData = {
            id: crypto.randomUUID(),
            type: 'CLOCK_IN',
            siteId: selectedSite,
            customerName: selectedSiteData?.customer_name || undefined,
            metadata: {
              siteName: selectedSiteData?.name,
              action: 'clock_in'
            }
          }
          break

        case 'CLOCK_OUT':
          qrImage = await QRService.generateClockOutQR(
            selectedSite,
            selectedSiteData?.customer_name || 'Unknown Customer'
          )
          qrData = {
            id: crypto.randomUUID(),
            type: 'CLOCK_OUT',
            siteId: selectedSite,
            customerName: selectedSiteData?.customer_name || undefined,
            metadata: {
              siteName: selectedSiteData?.name,
              action: 'clock_out'
            }
          }
          break

        case 'AREA':
          qrImage = await QRService.generateAreaQR(
            selectedArea,
            selectedAreaData?.customer_name || 'Unknown Customer',
            selectedAreaData?.area || 'Unknown Area'
          )
          qrData = {
            id: crypto.randomUUID(),
            type: 'AREA',
            areaId: selectedArea,
            customerName: selectedAreaData?.customer_name || undefined,
            metadata: {
              areaName: selectedAreaData?.area,
              floor: selectedAreaData?.floor,
              category: selectedAreaData?.category
            }
          }
          break

        case 'TASK':
          qrImage = await QRService.generateTaskQR(
            crypto.randomUUID(),
            selectedArea,
            selectedAreaData?.customer_name || 'Unknown Customer'
          )
          qrData = {
            id: crypto.randomUUID(),
            type: 'TASK',
            taskId: crypto.randomUUID(),
            areaId: selectedArea,
            customerName: selectedAreaData?.customer_name || undefined,
            metadata: {
              areaName: selectedAreaData?.area,
              taskDescription: selectedAreaData?.task_description
            }
          }
          break

        default:
          throw new Error('Invalid QR type')
      }

      setGeneratedQR(qrImage)
      setLastGenerated(qrData)
      onQRGenerated?.(qrData, qrImage)

      // Save to database if needed
      await saveQRCodeToDatabase(qrData, qrImage)

    } catch (error) {
      console.error('Error generating QR code:', error)
      alert('Failed to generate QR code')
    } finally {
      setIsGenerating(false)
    }
  }

  const saveQRCodeToDatabase = async (qrData: QRCodeData, qrImage: string) => {
    // Save to building_qr_codes table
    const { error } = await supabase
      .from('building_qr_codes')
      .insert({
        qr_code_id: qrData.id,
        customer_name: qrData.customerName,
        building_area: qrData.metadata?.areaName || qrData.metadata?.siteName || 'Unknown',
        area_description: qrData.metadata?.taskDescription || `${qrData.type} QR Code`,
        qr_code_url: JSON.stringify(qrData),
        qr_code_image_path: qrImage,
        is_active: true
      })

    if (error) {
      console.error('Error saving QR code to database:', error)
    }
  }

  const downloadQR = () => {
    if (!generatedQR) return

    const link = document.createElement('a')
    link.download = `qr-${qrType.toLowerCase()}-${Date.now()}.png`
    link.href = generatedQR
    link.click()
  }

  const copyQRData = async () => {
    if (!lastGenerated) return

    try {
      await navigator.clipboard.writeText(JSON.stringify(lastGenerated, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const getQRTypeColor = (type: QRCodeData['type']) => {
    switch (type) {
      case 'CLOCK_IN': return 'bg-green-500'
      case 'CLOCK_OUT': return 'bg-red-500'
      case 'AREA': return 'bg-blue-500'
      case 'TASK': return 'bg-yellow-500'
      case 'FEEDBACK': return 'bg-purple-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            QR Code Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* QR Type Selection */}
          <div className="space-y-2">
            <Label htmlFor="qr-type">QR Code Type</Label>
            <Select value={qrType} onValueChange={(value) => setQrType(value as QRCodeData['type'])}>
              <SelectTrigger>
                <SelectValue placeholder="Select QR code type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLOCK_IN">Clock In</SelectItem>
                <SelectItem value="CLOCK_OUT">Clock Out</SelectItem>
                <SelectItem value="AREA">Area Scan</SelectItem>
                <SelectItem value="TASK">Task QR</SelectItem>
                <SelectItem value="FEEDBACK">Feedback QR</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Site Selection */}
          {(qrType === 'CLOCK_IN' || qrType === 'CLOCK_OUT') && (
            <div className="space-y-2">
              <Label htmlFor="site">Site</Label>
              <Select value={selectedSite} onValueChange={setSelectedSite}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.site_id} value={site.site_id}>
                      {site.name} - {site.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Area Selection */}
          {(qrType === 'AREA' || qrType === 'TASK') && (
            <div className="space-y-2">
              <Label htmlFor="area">Area</Label>
              <Select value={selectedArea} onValueChange={setSelectedArea}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                      {area.area} - {area.customer_name} {area.floor && `(Floor ${area.floor})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Custom Text (for special cases) */}
          {qrType === 'FEEDBACK' && (
            <div className="space-y-2">
              <Label htmlFor="custom-text">Custom Description</Label>
              <Input
                id="custom-text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Enter custom description"
              />
            </div>
          )}

          {/* Generate Button */}
          <Button 
            onClick={generateQR} 
            disabled={isGenerating}
            className="w-full"
          >
            {isGenerating ? 'Generating...' : 'Generate QR Code'}
          </Button>
        </CardContent>
      </Card>

      {/* Generated QR Code Display */}
      {generatedQR && lastGenerated && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge className={getQRTypeColor(lastGenerated.type)}>
                {lastGenerated.type}
              </Badge>
              Generated QR Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* QR Code Image */}
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-lg border">
                <img 
                  src={generatedQR} 
                  alt="Generated QR Code"
                  className="w-64 h-64"
                />
              </div>
            </div>

            {/* QR Code Info */}
            <div className="space-y-2 text-sm">
              <div><strong>Type:</strong> {lastGenerated.type}</div>
              {lastGenerated.customerName && (
                <div><strong>Customer:</strong> {lastGenerated.customerName}</div>
              )}
              {lastGenerated.metadata?.siteName && (
                <div><strong>Site:</strong> {lastGenerated.metadata.siteName}</div>
              )}
              {lastGenerated.metadata?.areaName && (
                <div><strong>Area:</strong> {lastGenerated.metadata.areaName}</div>
              )}
              {lastGenerated.metadata?.floor && (
                <div><strong>Floor:</strong> {lastGenerated.metadata.floor}</div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={downloadQR} variant="outline" className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button onClick={copyQRData} variant="outline" className="flex-1">
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {copied ? 'Copied!' : 'Copy Data'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
