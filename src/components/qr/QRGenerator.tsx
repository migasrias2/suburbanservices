import React, { useMemo, useState } from 'react'
import { QrCode, Download, Copy, CheckCircle2, ChevronDown, RefreshCcw } from 'lucide-react'
import { QRService, ManualQRCodePayload, ManualQRCodeResult } from '@/services/qrService'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'

const QR_TYPES: ManualQRCodePayload['type'][] = ['AREA', 'CLOCK_IN', 'CLOCK_OUT', 'TASK', 'FEEDBACK']

interface ManualFieldConfig {
  label: string
  placeholder: string
  optional?: boolean
  helpText?: string
}

const manualFields: Record<string, ManualFieldConfig> = {
  customerName: {
    label: 'Customer Name',
    placeholder: 'e.g. Avtrade',
  },
  siteName: {
    label: 'Site / Building',
    placeholder: 'Optional site name',
    optional: true,
  },
  areaName: {
    label: 'Area Name',
    placeholder: 'e.g. Reception',
    helpText: 'This becomes the main label shown to cleaners when scanning.',
  },
  description: {
    label: 'Description',
    placeholder: 'Short description for the QR code',
    optional: true,
  },
  floor: {
    label: 'Floor',
    placeholder: 'e.g. Ground Floor',
    optional: true,
  },
  category: {
    label: 'Category',
    placeholder: 'e.g. Reception Common Areas',
    optional: true,
  },
  notes: {
    label: 'Internal Notes',
    placeholder: 'Optional extra details',
    optional: true,
  },
}

const initialPayload: ManualQRCodePayload = {
  type: 'AREA',
  customerName: '',
  siteName: '',
  areaName: '',
  description: '',
  floor: '',
  category: '',
  notes: '',
}

interface ManualQRGeneratorProps {
  onGenerated?: (result: ManualQRCodeResult) => void
}

export const QRGenerator: React.FC<ManualQRGeneratorProps> = ({ onGenerated }) => {
  const [formData, setFormData] = useState<ManualQRCodePayload>(initialPayload)
  const [result, setResult] = useState<ManualQRCodeResult | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const canGenerate = useMemo(() => {
    return !!(formData.customerName.trim() && formData.areaName.trim())
  }, [formData.customerName, formData.areaName])

  const handleChange = (field: keyof ManualQRCodePayload, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const resetForm = () => {
    setFormData(initialPayload)
    setResult(null)
    setCopied(false)
  }

  const generateQR = async () => {
    if (!canGenerate || isGenerating) return

    setIsGenerating(true)
    setCopied(false)

    try {
      const payload: ManualQRCodePayload = {
        ...formData,
        customerName: formData.customerName.trim(),
        siteName: formData.siteName?.trim() || undefined,
        areaName: formData.areaName.trim(),
        description: formData.description?.trim() || undefined,
        floor: formData.floor?.trim() || undefined,
        category: formData.category?.trim() || undefined,
        notes: formData.notes?.trim() || undefined,
      }

      const manualResult = await QRService.createManualQRCode(payload)
      setResult(manualResult)
      onGenerated?.(manualResult)

      toast({
        title: 'QR code created',
        description: `${manualResult.qrData.metadata?.areaName || manualResult.qrData.metadata?.siteName || 'Area'} saved to library.`,
      })
    } catch (error) {
      console.error('Failed to create QR code:', error)
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const downloadQR = () => {
    if (!result?.dataUrl) return

    const link = document.createElement('a')
    const areaName = result.qrData.metadata?.areaName || 'area'
    const customer = result.qrData.customerName?.replace(/\s+/g, '_').toLowerCase() || 'customer'
    const safeArea = areaName.replace(/\s+/g, '_').toLowerCase()

    link.download = `${customer}-${safeArea}-${result.qrData.type.toLowerCase()}.png`
    link.href = result.dataUrl
    link.click()
  }

  const copyPayload = async () => {
    if (!result?.qrData) return

    try {
      await navigator.clipboard.writeText(JSON.stringify(result.qrData, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy payload:', error)
    }
  }

  return (
    <div className="w-full space-y-6">
      <Card className="border-0 shadow-xl rounded-3xl">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-3 text-2xl font-semibold text-gray-900">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100">
              <QrCode className="h-5 w-5 text-[#00339B]" />
            </span>
            Create New Area QR Code
          </CardTitle>
          <p className="text-gray-600">Name the customer and area, then generate a QR that matches the live workflow.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">QR Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => handleChange('type', value as ManualQRCodePayload['type'])}
              >
                <SelectTrigger className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700">
                  <SelectValue placeholder="Select QR type" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border border-gray-100 shadow-xl">
                  {QR_TYPES.map(type => (
                    <SelectItem key={type} value={type} className="capitalize">
                      {type.replace('_', ' ').toLowerCase().replace(/^./, char => char.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">Customer Name</Label>
              <Input
                placeholder={manualFields.customerName.placeholder}
                value={formData.customerName}
                onChange={(event) => handleChange('customerName', event.target.value)}
                className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
              />
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">Site / Building</Label>
              <Input
                placeholder={manualFields.siteName.placeholder}
                value={formData.siteName}
                onChange={(event) => handleChange('siteName', event.target.value)}
                className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">Area Name</Label>
              <Input
                placeholder={manualFields.areaName.placeholder}
                value={formData.areaName}
                onChange={(event) => handleChange('areaName', event.target.value)}
                className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
              />
              <p className="text-xs text-gray-500">Shown to cleaners after scanning.</p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">Description</Label>
              <Input
                placeholder={manualFields.description.placeholder}
                value={formData.description}
                onChange={(event) => handleChange('description', event.target.value)}
                className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Floor</Label>
                <Input
                  placeholder={manualFields.floor.placeholder}
                  value={formData.floor}
                  onChange={(event) => handleChange('floor', event.target.value)}
                  className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
                />
              </div>
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Category</Label>
                <Input
                  placeholder={manualFields.category.placeholder}
                  value={formData.category}
                  onChange={(event) => handleChange('category', event.target.value)}
                  className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-semibold text-gray-700">Internal Notes</Label>
            <Textarea
              placeholder={manualFields.notes.placeholder}
              value={formData.notes}
              onChange={(event) => handleChange('notes', event.target.value)}
              className="min-h-[100px] rounded-2xl border-gray-200 bg-gray-50/70 px-4 py-3 text-gray-700"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              onClick={generateQR}
              disabled={!canGenerate || isGenerating}
              className="flex-1 rounded-full bg-[#00339B] py-5 text-lg font-semibold text-white shadow-lg transition hover:bg-[#002d7a]"
            >
              {isGenerating ? (
                <RefreshCcw className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <QrCode className="mr-2 h-5 w-5" />
              )}
              {isGenerating ? 'Generating...' : 'Generate QR Code'}
            </Button>
            <Button
              variant="outline"
              onClick={resetForm}
              className="rounded-full border-gray-200 px-6 text-gray-700"
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-0 shadow-xl rounded-3xl">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-3 text-xl font-semibold text-gray-900">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </span>
              QR Code Ready
            </CardTitle>
            <p className="text-gray-600">Stored in the QR library with the metadata below.</p>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[300px,1fr]">
            <div className="flex justify-center">
              <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-inner">
                <img
                  src={result.dataUrl}
                  alt="Generated QR Code"
                  className="h-64 w-64"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                  <Label className="text-xs uppercase text-gray-500">QR Type</Label>
                  <p className="mt-1 text-base font-semibold text-gray-900 flex items-center gap-2">
                    <Badge className="rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-xs font-semibold">
                      {result.qrData.type}
                    </Badge>
                    {result.qrData.metadata?.areaName || result.qrData.metadata?.siteName || 'Area'}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                  <Label className="text-xs uppercase text-gray-500">Customer</Label>
                  <p className="mt-1 text-base font-semibold text-gray-900">{result.qrData.customerName}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {formData.siteName ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <Label className="text-xs uppercase text-gray-500">Site</Label>
                    <p className="mt-1 text-base font-semibold text-gray-900">{formData.siteName}</p>
                  </div>
                ) : null}
                {formData.floor ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <Label className="text-xs uppercase text-gray-500">Floor</Label>
                    <p className="mt-1 text-base font-semibold text-gray-900">{formData.floor}</p>
                  </div>
                ) : null}
                {formData.category ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <Label className="text-xs uppercase text-gray-500">Category</Label>
                    <p className="mt-1 text-base font-semibold text-gray-900">{formData.category}</p>
                  </div>
                ) : null}
                {formData.description ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <Label className="text-xs uppercase text-gray-500">Description</Label>
                    <p className="mt-1 text-base font-semibold text-gray-900">{formData.description}</p>
                  </div>
                ) : null}
                {formData.notes ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 sm:col-span-2">
                    <Label className="text-xs uppercase text-gray-500">Internal Notes</Label>
                    <p className="mt-1 text-base text-gray-700">{formData.notes}</p>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={downloadQR} className="flex-1 rounded-full bg-[#00339B] py-4 text-white">
                  <Download className="mr-2 h-4 w-4" />
                  Download PNG
                </Button>
                <Button onClick={copyPayload} variant="outline" className="flex-1 rounded-full border-gray-200 py-4 text-gray-700">
                  {copied ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  {copied ? 'Copied' : 'Copy JSON'}
                </Button>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                <div className="flex items-start gap-2">
                  <ChevronDown className="mt-0.5 h-4 w-4" />
                  <div>
                    <p className="font-semibold">Saved to Library</p>
                    <p>
                      This QR code is available in the QR Library and ready for cleaners to scan.
                      Use the testing panel to verify the workflow instantly.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
