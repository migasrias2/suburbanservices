import React, { useEffect, useMemo, useState } from 'react'
import { QrCode, Download, Copy, CheckCircle2, ChevronDown, RefreshCcw } from 'lucide-react'
import { QRService, ManualQRCodePayload, ManualQRCodeResult } from '@/services/qrService'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/components/ui/use-toast'
import { fetchCustomers } from '@/services/customersService'
import type { Customer } from '@/services/supabase'

const appBaseUrl = (import.meta.env.VITE_PUBLIC_APP_URL?.replace(/\/$/, '') || window.location.origin)
const assistBaseUrl = `${appBaseUrl}/bathroom-assist`

const initialPayload: ManualQRCodePayload = {
  type: 'AREA',
  customerId: '',
  customerName: '',
  areaName: '',
}

interface ManualQRGeneratorProps {
  onGenerated?: (result: ManualQRCodeResult) => void
}

const formatQrType = (type: ManualQRCodePayload['type']) =>
  type.replace('_', ' ').toLowerCase().replace(/^./, char => char.toUpperCase())

export const QRGenerator: React.FC<ManualQRGeneratorProps> = ({ onGenerated }) => {
  const [formData, setFormData] = useState<ManualQRCodePayload>(initialPayload)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [result, setResult] = useState<ManualQRCodeResult | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const canGenerate = useMemo(() => {
    return Boolean(formData.customerId?.trim() && formData.areaName?.trim())
  }, [formData.areaName, formData.customerId])

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers
    const normalized = customerSearch.trim().toLowerCase()
    return customers.filter(customer => {
      const name = customer.display_name || customer.customer_name || customer.name || ''
      return name.toLowerCase().includes(normalized)
    })
  }, [customers, customerSearch])

  useEffect(() => {
    let mounted = true
    const loadCustomers = async () => {
      try {
        setIsLoadingCustomers(true)
        const data = await fetchCustomers()
        if (!mounted) return
        setCustomers(data)
      } catch (error) {
        console.error('Failed to load customers for manual QR generator:', error)
        toast({
          title: 'Failed to load customers',
          description: 'Please refresh the page or try again later.',
          variant: 'destructive',
        })
      } finally {
        if (mounted) {
          setIsLoadingCustomers(false)
        }
      }
    }

    loadCustomers()

    return () => {
      mounted = false
    }
  }, [toast])

  const resetForm = () => {
    setFormData(initialPayload)
    setResult(null)
    setCopied(false)
    setCustomerSearch('')
  }

  const generateQR = async () => {
    if (!canGenerate || isGenerating) return

    setIsGenerating(true)
    setCopied(false)

    try {
      const payload: ManualQRCodePayload = {
        ...formData,
        customerName: formData.customerName?.trim() || '',
        areaName: formData.areaName?.trim() || '',
      }

      if (payload.type === 'FEEDBACK' && payload.metadata?.assistBathroom) {
        const params = new URLSearchParams({
          customer: payload.customerName,
          bathroom: payload.areaName || payload.metadata.assistBathroom,
          qr: payload.metadata.qrCodeId || ''
        })
        payload.rawValue = `${assistBaseUrl}?${params.toString()}`
      }

      const manualResult = await QRService.createManualQRCode(payload)
      setResult(manualResult)
      onGenerated?.(manualResult)

      toast({
        title: 'QR created',
        description: `${manualResult.qrData.metadata?.areaName?.trim() || manualResult.qrData.customerName} saved.`,
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

    const identifier = result.qrData.metadata?.areaName?.trim() || result.qrData.customerName || 'qr-code'
    const customer = result.qrData.customerName?.replace(/\s+/g, '_').toLowerCase() || 'customer'
    const safeIdentifier = identifier.replace(/\s+/g, '_').toLowerCase()

    const link = document.createElement('a')
    link.download = `${customer}-${safeIdentifier}-${result.qrData.type.toLowerCase()}.png`
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
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl font-semibold text-gray-900">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100">
              <QrCode className="h-5 w-5 text-[#00339B]" />
            </span>
            Generate QR Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-gray-700">QR Type</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-12 w-full justify-between rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
                  >
                    {formData.type ? formatQrType(formData.type) : 'Select'}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] rounded-2xl border border-gray-100 bg-white p-1.5 shadow-xl">
                  <Command className="rounded-2xl bg-white text-gray-700 [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-0">
                    <CommandList className="max-h-56">
                      <CommandGroup className="space-y-1 p-1.5">
                        {(['AREA', 'CLOCK_IN', 'CLOCK_OUT', 'TASK', 'FEEDBACK', 'RAW'] as ManualQRCodePayload['type'][]).map(type => (
                          <CommandItem
                            key={type}
                            value={type}
                            className="rounded-xl px-3 py-2 text-sm text-gray-700 data-[selected=true]:bg-blue-50 data-[selected=true]:text-[#00339B]"
                            onSelect={() => {
                              setFormData(prev => ({ ...prev, type }))
                            }}
                          >
                            {formatQrType(type)}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-gray-700">Customer</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-12 w-full justify-between rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
                    disabled={isLoadingCustomers}
                  >
                    {formData.customerId
                      ? customers.find(customer => customer.id === formData.customerId)?.display_name || formData.customerName || 'Select'
                      : isLoadingCustomers
                        ? 'Loading...'
                        : 'Select'}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] rounded-2xl border border-gray-100 bg-white p-1.5 shadow-xl">
                  <Command className="rounded-2xl bg-white text-gray-700 [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-0">
                    <CommandInput
                      placeholder="Search customers"
                      value={customerSearch}
                      onValueChange={setCustomerSearch}
                      className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 placeholder:text-gray-400"
                    />
                    <CommandEmpty className="py-6 text-center text-sm text-gray-500">
                      {isLoadingCustomers ? 'Loading...' : 'No matches'}
                    </CommandEmpty>
                    <CommandList className="max-h-56">
                      <CommandGroup className="space-y-1 p-1.5">
                        {filteredCustomers.length === 0 && !isLoadingCustomers ? (
                          <CommandItem disabled value="no-results" className="rounded-xl px-3 py-2 text-sm text-gray-400">
                            No customers yet
                          </CommandItem>
                        ) : null}
                        {filteredCustomers.map(customer => {
                          const displayName = customer.display_name || customer.customer_name || customer.name || 'Unnamed customer'
                          return (
                            <CommandItem
                              key={customer.id}
                              value={customer.id}
                              className="rounded-xl px-3 py-2 text-sm text-gray-700 data-[selected=true]:bg-blue-50 data-[selected=true]:text-[#00339B]"
                              onSelect={() => {
                                setFormData(prev => ({
                                  ...prev,
                                  customerId: customer.id,
                                  customerName: displayName,
                                }))
                              }}
                            >
                              {displayName}
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-gray-700">QR Name</Label>
              <Input
                placeholder="e.g. Reception"
                value={formData.areaName}
                onChange={(event) =>
                  setFormData(prev => ({
                    ...prev,
                    areaName: event.target.value,
                    metadata: {
                      ...(prev.metadata || {}),
                      assistBathroom: event.target.value
                    }
                  }))
                }
                className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-gray-700"
              />
            </div>
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
              {isGenerating ? 'Generating...' : 'Generate'}
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
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl font-semibold text-gray-900">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </span>
              QR Ready
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[280px,1fr]">
            <div className="flex justify-center">
              <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-inner">
                <img
                  src={result.dataUrl}
                  alt="Generated QR Code"
                  className="h-56 w-56"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                  <Label className="text-xs uppercase text-gray-500">Type</Label>
                  <p className="mt-1 text-base font-semibold text-gray-900 flex items-center gap-2">
                    <Badge className="rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-xs font-semibold">
                      {result.qrData.type}
                    </Badge>
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                  <Label className="text-xs uppercase text-gray-500">Customer</Label>
                  <p className="mt-1 text-base font-semibold text-gray-900">{result.qrData.customerName}</p>
                </div>
                {result.qrData.metadata?.areaName && (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <Label className="text-xs uppercase text-gray-500">Name</Label>
                    <p className="mt-1 text-base font-semibold text-gray-900">{result.qrData.metadata.areaName}</p>
                  </div>
                )}
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
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}



