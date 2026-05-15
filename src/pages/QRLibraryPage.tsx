import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { QRUploadManager } from '../components/qr/QRUploadManager'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { Checkbox } from '../components/ui/checkbox'
import {
  QrCode,
  Search,
  Download,
  Upload,
  Trash2,
  CheckSquare,
  XCircle,
  ChevronDown,
} from 'lucide-react'
import { supabase } from '../services/supabase'
import { getStoredCleanerName } from '../lib/identity'
import JSZip from 'jszip'

interface QRCodeItem {
  id: string
  customer: string
  customerKey: string
  area: string
  subArea: string
  floor: string
  category: string
  qrCodeData: string
  imageUrl?: string
  createdAt: string
}

export default function QRLibraryPage() {
  const navigate = useNavigate()
  const [userType, setUserType] = useState<'cleaner' | 'manager' | 'ops_manager' | 'admin' | ''>('')
  const [userId, setUserId] = useState<string>('')
  const [userName, setUserName] = useState<string>('')
  const [qrCodes, setQrCodes] = useState<QRCodeItem[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [downloadingSelected, setDownloadingSelected] = useState(false)
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())

  useEffect(() => {
    const type = localStorage.getItem('userType')
    const id = localStorage.getItem('userId')
    const name = getStoredCleanerName()

    if (!type || !id || !name || type !== 'admin') {
      navigate('/login')
      return
    }

    setUserType(type as 'admin')
    setUserId(id)
    setUserName(name)
    loadQRCodes()
  }, [navigate])

  const normalizeCustomerName = (input?: string) => {
    const trimmed = (input || '').trim()
    if (!trimmed) {
      return { key: 'unknown', display: 'Unknown' }
    }
    const lower = trimmed.toLowerCase()
    return { key: lower, display: lower === 'psm' ? 'psm' : trimmed }
  }

  const loadQRCodes = async (showLoading = true) => {
    if (showLoading) setLoading(true)

    try {
      const { data, error } = await supabase
        .from('building_qr_codes')
        .select('qr_code_id, customer_name, building_area, area_description, qr_code_url, qr_code_image_path, created_at, is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error loading QR codes:', error)
        return
      }

      if (data) {
        const mapped: QRCodeItem[] = data.map((row: any) => {
          let parsed: any
          try { parsed = JSON.parse(row.qr_code_url) } catch { parsed = {} }
          const rawCustomer = row.customer_name || parsed.customerName || ''
          const { key: customerKey, display: customerDisplay } = normalizeCustomerName(rawCustomer)
          return {
            id: row.qr_code_id,
            customer: customerDisplay,
            customerKey,
            area: row.building_area || parsed.metadata?.areaName || parsed.metadata?.siteName || '',
            subArea: row.area_description || parsed.type || '',
            floor: parsed.metadata?.floor || '',
            category: parsed.metadata?.category || row.category || '',
            qrCodeData: row.qr_code_url,
            imageUrl: row.qr_code_image_path,
            createdAt: row.created_at
          }
        })

        const filtered = mapped.filter(qr => typeof qr.imageUrl === 'string' && /^(https?:)?\/\//.test(qr.imageUrl || ''))
        setQrCodes(filtered)
      }
    } catch (error) {
      console.error('Error in loadQRCodes:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredQRCodes = useMemo(() => {
    const q = searchTerm.toLowerCase().trim()
    if (!q) return qrCodes
    return qrCodes.filter((qr) =>
      qr.area.toLowerCase().includes(q) ||
      qr.subArea.toLowerCase().includes(q) ||
      qr.customer.toLowerCase().includes(q)
    )
  }, [qrCodes, searchTerm])

  const groupedByCustomer = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; items: QRCodeItem[] }>()
    filteredQRCodes.forEach((qr) => {
      if (!groups.has(qr.customerKey)) {
        groups.set(qr.customerKey, { key: qr.customerKey, label: qr.customer, items: [] })
      }
      groups.get(qr.customerKey)!.items.push(qr)
    })
    return Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length)
  }, [filteredQRCodes])

  if (!userType || !userId || !userName) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  const toggleSelecting = () => {
    setIsSelecting((prev) => !prev)
    setSelectedIds([])
  }

  const toggleExpanded = (key: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleToggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleToggleGroupSelection = (group: { items: QRCodeItem[] }) => {
    const ids = group.items.map((q) => q.id)
    const allSelected = ids.every((id) => selectedIds.includes(id))
    setSelectedIds((prev) => {
      if (allSelected) {
        return prev.filter((id) => !ids.includes(id))
      }
      const set = new Set(prev)
      ids.forEach((id) => set.add(id))
      return Array.from(set)
    })
  }

  const generateQRCodeImage = (data: string, fallbackUrl?: string) => {
    try {
      JSON.parse(data)
      if (fallbackUrl) return fallbackUrl
      return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`
    } catch {
      return fallbackUrl || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`
    }
  }

  const handleUploadComplete = async (uploadedFiles: any[]) => {
    const anyCompleted = uploadedFiles.some((f) => f.status === 'completed')
    if (anyCompleted) {
      await loadQRCodes(true)
      setUploadDialogOpen(false)
    }
  }

  const handleDeleteQR = async (qrId: string) => {
    if (!confirm('Are you sure you want to delete this QR code?')) return

    const originalQrCodes = [...qrCodes]
    setQrCodes((prev) => prev.filter((qr) => qr.id !== qrId))

    try {
      const { data, error } = await supabase
        .from('building_qr_codes')
        .update({ is_active: false, deactivated_at: new Date().toISOString() })
        .eq('qr_code_id', qrId)
        .select('qr_code_id, is_active')

      if (error) {
        setQrCodes(originalQrCodes)
        alert(`Failed to delete QR code: ${error.message}`)
        return
      }

      if (!data || data.length === 0) {
        return
      }
    } catch (error) {
      setQrCodes(originalQrCodes)
      alert(`An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDownloadQR = async (qr: QRCodeItem) => {
    try {
      const imageUrl = qr.imageUrl || generateQRCodeImage(qr.qrCodeData, qr.imageUrl)
      const link = document.createElement('a')
      link.href = imageUrl
      link.download = `${qr.customer}_${qr.area}_QR.png`
      link.target = '_blank'

      if (imageUrl.startsWith('http')) {
        const response = await fetch(imageUrl)
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        link.href = blobUrl
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
      } else {
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } catch (error) {
      console.error('Error downloading QR code:', error)
      alert('Failed to download QR code. Please try again.')
    }
  }

  const handleDownloadSelected = async () => {
    if (selectedIds.length === 0 || downloadingSelected) return

    try {
      setDownloadingSelected(true)
      const selectedQRCodes = filteredQRCodes.filter((qr) => selectedIds.includes(qr.id))

      if (selectedQRCodes.length === 0) {
        alert('No QR codes selected in the current filters.')
        return
      }

      const zip = new JSZip()

      await Promise.all(
        selectedQRCodes.map(async (qr) => {
          const imageUrl = qr.imageUrl || generateQRCodeImage(qr.qrCodeData, qr.imageUrl)
          const response = await fetch(imageUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch ${qr.area} QR code`)
          }
          const blob = await response.blob()
          const arrayBuffer = await blob.arrayBuffer()
          const sanitizedCustomer = qr.customer.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'customer'
          const sanitizedArea = qr.area.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'area'
          const fileName = `${sanitizedCustomer}_${sanitizedArea}.png`.toLowerCase()
          zip.file(fileName, arrayBuffer)
        })
      )

      const content = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(content)
      link.download = `qr-codes-${new Date().toISOString()}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)

      setSelectedIds([])
      setIsSelecting(false)
    } catch (error) {
      console.error('Bulk download failed:', error)
      alert('Failed to download selected QR codes. Please try again.')
    } finally {
      setDownloadingSelected(false)
    }
  }

  return (
    <Sidebar07Layout userType={(userType || 'admin') as 'cleaner' | 'manager' | 'ops_manager' | 'admin'} userName={userName}>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl lg:text-4xl font-semibold text-gray-900 tracking-tight">QR Library</h1>
            <p className="text-gray-500 mt-1">{qrCodes.length} codes across {groupedByCustomer.length} customers</p>
          </div>
          <div className="flex gap-2 items-center">
            {isSelecting && selectedIds.length > 0 && (
              <Button
                disabled={downloadingSelected}
                className="gap-2 rounded-full text-white px-5"
                style={{ backgroundColor: '#00339B' }}
                onClick={handleDownloadSelected}
              >
                <Download className="h-4 w-4" />
                {downloadingSelected ? 'Preparing…' : `Download ${selectedIds.length}`}
              </Button>
            )}
            <Button
              variant="outline"
              className="rounded-full gap-2 border-gray-200 text-gray-700"
              onClick={toggleSelecting}
            >
              {isSelecting ? (
                <>
                  <XCircle className="h-4 w-4" />
                  Cancel
                </>
              ) : (
                <>
                  <CheckSquare className="h-4 w-4" />
                  Select
                </>
              )}
            </Button>
            <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
              setUploadDialogOpen(open)
              if (open) {
                setIsSelecting(false)
                setSelectedIds([])
              }
            }}>
              <DialogTrigger asChild>
                <Button className="gap-2 rounded-full text-white" style={{ backgroundColor: '#00339B' }}>
                  <Upload className="h-4 w-4" />
                  Upload
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto !rounded-3xl border-0 p-6 shadow-2xl bg-white">
                <DialogHeader>
                  <DialogTitle className="sr-only">Upload QR Codes</DialogTitle>
                </DialogHeader>
                <QRUploadManager onUploadComplete={handleUploadComplete} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Search customers or areas"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-11 h-12 rounded-2xl border-gray-200 bg-white text-base shadow-sm focus-visible:ring-1 focus-visible:ring-gray-300"
          />
        </div>

        {/* Grouped list */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent"></div>
          </div>
        ) : groupedByCustomer.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
            <QrCode className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">No QR codes found</p>
            <p className="text-gray-400 text-sm mt-1">Try adjusting your search</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedByCustomer.map((group) => {
              const isExpanded = expandedCustomers.has(group.key)
              const sampleQR = group.items[0]
              const groupSelectedCount = group.items.filter((q) => selectedIds.includes(q.id)).length
              const allGroupSelected = groupSelectedCount === group.items.length && group.items.length > 0
              return (
                <div
                  key={group.key}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-shadow hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(group.key)}
                    className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-gray-50/60 transition-colors"
                  >
                    {/* Stacked QR thumbnail */}
                    <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0">
                      {group.items.length > 1 && (
                        <div className="absolute inset-0 bg-white border border-gray-200 rounded-xl rotate-[-6deg] translate-x-1 translate-y-1" />
                      )}
                      <img
                        src={sampleQR.imageUrl || generateQRCodeImage(sampleQR.qrCodeData, sampleQR.imageUrl)}
                        alt={`QR for ${group.label}`}
                        className="relative w-16 h-16 sm:w-20 sm:h-20 border border-gray-200 rounded-xl bg-white object-cover"
                      />
                    </div>

                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-base sm:text-lg truncate capitalize">
                        {group.label}
                      </h3>
                      <p className="text-sm text-gray-500 mt-0.5">{group.items.length} QR codes</p>
                    </div>

                    {/* Count badge + chevron */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold tabular-nums">
                        {group.items.length}
                      </span>
                      <ChevronDown
                        className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/40 p-4 sm:p-5">
                      {isSelecting && (
                        <div className="flex items-center justify-between mb-3 px-1">
                          <button
                            type="button"
                            onClick={() => handleToggleGroupSelection(group)}
                            className="text-sm font-medium text-[#00339B] hover:underline"
                          >
                            {allGroupSelected ? 'Unselect all in group' : 'Select all in group'}
                          </button>
                          {groupSelectedCount > 0 && (
                            <span className="text-xs text-gray-500">{groupSelectedCount} selected</span>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {group.items.map((qr) => {
                          const isChecked = selectedIds.includes(qr.id)
                          return (
                            <div
                              key={qr.id}
                              className={`group relative bg-white rounded-xl border p-3 transition-all ${
                                isSelecting && isChecked
                                  ? 'border-[#00339B] ring-2 ring-[#00339B]/20'
                                  : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                              }`}
                              onClick={(e) => {
                                if (!isSelecting) return
                                const target = e.target as HTMLElement
                                if (target.closest('button')) return
                                handleToggleSelection(qr.id)
                              }}
                              role={isSelecting ? 'button' : undefined}
                            >
                              {isSelecting && (
                                <div className="absolute top-2 left-2 z-10">
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => handleToggleSelection(qr.id)}
                                    className="h-5 w-5 rounded-md border-2 border-white shadow"
                                  />
                                </div>
                              )}
                              <img
                                src={qr.imageUrl || generateQRCodeImage(qr.qrCodeData, qr.imageUrl)}
                                alt={`QR for ${qr.area}`}
                                className="w-full aspect-square rounded-lg border border-gray-100 bg-white"
                              />
                              <div className="mt-2 min-h-[2.5rem]">
                                <p className="text-sm font-medium text-gray-900 truncate">{qr.area || 'Untitled'}</p>
                                {qr.subArea && (
                                  <p className="text-xs text-gray-500 truncate">{qr.subArea}</p>
                                )}
                              </div>
                              <div className="flex gap-1.5 mt-2">
                                <Button
                                  size="sm"
                                  className="flex-1 h-8 gap-1 rounded-full text-white text-xs"
                                  style={{ backgroundColor: '#00339B' }}
                                  onClick={() => handleDownloadQR(qr)}
                                >
                                  <Download className="h-3 w-3" />
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteQR(qr.id)}
                                  aria-label="Delete QR code"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Sidebar07Layout>
  )
}
