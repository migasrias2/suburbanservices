import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { QRUploadManager } from '../components/qr/QRUploadManager'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { Checkbox } from '../components/ui/checkbox'
import { 
  QrCode, 
  Search, 
  Filter, 
  Download, 
  Upload,
  Building2,
  MapPin,
  FileImage,
  Grid3X3,
  List,
  Plus,
  Trash2,
  CheckSquare,
  XCircle
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
  const [selectedCustomer, setSelectedCustomer] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [loading, setLoading] = useState(true)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [downloadingSelected, setDownloadingSelected] = useState(false)

  useEffect(() => {
    // Get user info from localStorage
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
        
        // Hide legacy/mock rows (e.g., base64 images or placeholder data)
        const filtered = mapped.filter(qr => typeof qr.imageUrl === 'string' && /^(https?:)?\/\//.test(qr.imageUrl || ''))
        console.log(`Loaded ${filtered.length} QR codes`)
        setQrCodes(filtered)
      }
    } catch (error) {
      console.error('Error in loadQRCodes:', error)
    } finally {
      setLoading(false)
    }
  }

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>()
    qrCodes.forEach((qr) => {
      if (!map.has(qr.customerKey)) {
        map.set(qr.customerKey, qr.customer)
      }
    })
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }))
  }, [qrCodes])

  const filteredQRCodes = qrCodes.filter(qr => {
    const matchesSearch = qr.area.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         qr.subArea.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         qr.customer.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCustomer = selectedCustomer === 'all' || qr.customerKey === selectedCustomer
    
    return matchesSearch && matchesCustomer
  })

  if (!userType || !userId || !userName) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  const toggleSelecting = () => {
    setIsSelecting((prev) => !prev)
    setSelectedIds([])
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredQRCodes.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredQRCodes.map((qr) => qr.id))
    }
  }

  const handleToggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleSelectableClick = (event: React.MouseEvent, id: string) => {
    if (!isSelecting) return
    const target = event.target as HTMLElement
    if (target.closest('button') || target.closest('a')) return
    handleToggleSelection(id)
  }

  const handleSelectableKeyDown = (event: React.KeyboardEvent, id: string) => {
    if (!isSelecting) return
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      handleToggleSelection(id)
    }
  }

  const generateQRCodeImage = (data: string, fallbackUrl?: string) => {
    try {
      const parsed = JSON.parse(data)
      // If we stored imageUrl separately, prefer it
      if (fallbackUrl) return fallbackUrl
      // Otherwise generate a QR from the encoded payload
      return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`
    } catch {
      return fallbackUrl || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`
    }
  }

  const handleUploadComplete = async (uploadedFiles: any[]) => {
    // If at least one succeeded, refresh the library and close dialog
    const anyCompleted = uploadedFiles.some((f) => f.status === 'completed')
    if (anyCompleted) {
      await loadQRCodes(true)
      setUploadDialogOpen(false)
    }
  }

  const handleDeleteQR = async (qrId: string) => {
    if (!confirm('Are you sure you want to delete this QR code?')) return
    
    // Optimistically remove from UI first
    const originalQrCodes = [...qrCodes]
    setQrCodes(prev => prev.filter(qr => qr.id !== qrId))
    
    try {
      console.log('Deleting QR code:', qrId)
      
      // Perform the delete operation (mark as inactive)
      const { data, error } = await supabase
        .from('building_qr_codes')
        .update({ 
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
        .eq('qr_code_id', qrId)
        .select('qr_code_id, is_active')
      
      if (error) {
        console.error('Delete error:', error)
        setQrCodes(originalQrCodes)
        alert(`Failed to delete QR code: ${error.message}`)
        return
      }
      
      if (!data || data.length === 0) {
        console.warn('QR code not found in database')
        // Keep it removed from UI since it doesn't exist
        return
      }
      
      console.log('QR code successfully deleted')
      
    } catch (error) {
      console.error('Delete exception:', error)
      setQrCodes(originalQrCodes)
      alert(`An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDownloadQR = async (qr: QRCodeItem) => {
    try {
      const imageUrl = qr.imageUrl || generateQRCodeImage(qr.qrCodeData, qr.imageUrl)
      
      // Create a temporary link to download the image
      const link = document.createElement('a')
      link.href = imageUrl
      link.download = `${qr.customer}_${qr.area}_QR.png`
      link.target = '_blank'
      
      // For external URLs (like Supabase storage), we need to fetch and create blob
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
        // For data URLs, direct download
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

      // Reset selection after download
      setSelectedIds([])
      setIsSelecting(false)
    } catch (error) {
      console.error('Bulk download failed:', error)
      alert('Failed to download selected QR codes. Please try again.')
    } finally {
      setDownloadingSelected(false)
    }
  }

  const getTypeColor = (type: string) => {
    switch (type?.toUpperCase()) {
      case 'CLOCK_IN': return 'bg-green-100 text-green-700'
      case 'CLOCK_OUT': return 'bg-red-100 text-red-700'
      case 'AREA': return 'bg-blue-100 text-blue-700'
      case 'TASK': return 'bg-yellow-100 text-yellow-700'
      case 'FEEDBACK': return 'bg-purple-100 text-purple-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  return (
    <Sidebar07Layout userType={(userType || 'admin') as 'cleaner' | 'manager' | 'ops_manager' | 'admin'} userName={userName}>
      <div className="space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              QR Code Library
            </h1>
            <p className="text-gray-600 text-lg">Manage and organize all customer area QR codes</p>
          </div>
          <div className="flex gap-3 items-center">
            {isSelecting && filteredQRCodes.length > 0 && (
              <>
                <Button
                  variant="outline"
                  className="rounded-full border-gray-200 text-gray-700 gap-2"
                  onClick={toggleSelectAll}
                >
                  <CheckSquare className="h-4 w-4" />
                  {selectedIds.length === filteredQRCodes.length ? 'Unselect All' : 'Select All'}
                </Button>
                <Button
                  disabled={selectedIds.length === 0 || downloadingSelected}
                  className="gap-2 rounded-full text-white px-6"
                  style={{ backgroundColor: '#00339B' }}
                  onClick={handleDownloadSelected}
                >
                  <Download className="h-4 w-4" />
                  {downloadingSelected ? 'Preparing...' : 'Download Selected'}
                </Button>
              </>
            )}
            <Button
              variant={isSelecting ? 'secondary' : 'outline'}
              className={`rounded-full gap-2 ${isSelecting ? 'text-white' : 'text-gray-700'}`}
              style={isSelecting ? { backgroundColor: '#00339B' } : undefined}
              onClick={toggleSelecting}
            >
              {isSelecting ? (
                <>
                  <XCircle className="h-4 w-4" />
                  Cancel Selection
                </>
              ) : (
                <>
                  <CheckSquare className="h-4 w-4" />
                  Select QR Codes
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
                  Upload QR Codes
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

        {/* Filters and Search */}
        <Card className="border-0 shadow-xl rounded-3xl">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-600 mb-2 block">Search QR Codes</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by area, customer, or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 rounded-full border-gray-200 focus:border-gray-300 focus:ring-gray-200/50"
                  />
                </div>
              </div>
              
              <div className="flex gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">Customer</label>
                  <select
                    value={selectedCustomer}
                    onChange={(e) => setSelectedCustomer(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00339B] bg-white"
                  >
                    <option value="all">All Customers</option>
                    {customerOptions.map(option => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">View</label>
                  <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white">
                    <Button
                      variant={viewMode === 'grid' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('grid')}
                      className="rounded-none"
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('list')}
                      className="rounded-none"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        <div className="flex justify-center gap-8 py-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-[#00339B] mb-1">{qrCodes.length}</div>
            <div className="text-sm font-medium text-gray-500">Total QR Codes</div>
          </div>
          <div className="w-px bg-gray-200"></div>
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-700 mb-1">{customerOptions.length}</div>
            <div className="text-sm font-medium text-gray-500">Customers</div>
          </div>
          <div className="w-px bg-gray-200"></div>
          <div className="text-center">
            <div className="text-3xl font-bold text-[#dc2626] mb-1">{filteredQRCodes.length}</div>
            <div className="text-sm font-medium text-gray-500">Filtered Results</div>
          </div>
        </div>

        {/* QR Codes Display */}
        <Card className="card-modern border-0 shadow-xl">
          <CardContent className="p-6">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
              </div>
            ) : filteredQRCodes.length === 0 ? (
              <div className="text-center py-12">
                <QrCode className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">No QR codes found</p>
                <p className="text-gray-400">Try adjusting your search filters</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredQRCodes.map((qr) => (
                  <Card
                    key={qr.id}
                    className={`border-0 shadow-lg hover:shadow-xl transition-shadow rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#00339B] ${
                      isSelecting && selectedIds.includes(qr.id) ? 'ring-2 ring-[#00339B]/60' : ''
                    }`}
                    tabIndex={isSelecting ? 0 : -1}
                    onClick={(event) => handleSelectableClick(event, qr.id)}
                    onKeyDown={(event) => handleSelectableKeyDown(event, qr.id)}
                    role={isSelecting ? 'button' : undefined}
                    aria-pressed={isSelecting ? selectedIds.includes(qr.id) : undefined}
                  >
                    <CardContent className="p-4">
                      <div className="text-center flex flex-col h-full">
                        <div className="relative">
                          {isSelecting && (
                            <div className="absolute left-1 top-1">
                              <Checkbox
                                checked={selectedIds.includes(qr.id)}
                                onCheckedChange={() => handleToggleSelection(qr.id)}
                                className="h-6 w-6 rounded-lg border-2 border-white shadow"
                              />
                            </div>
                          )}
                          <img
                            src={qr.imageUrl || generateQRCodeImage(qr.qrCodeData, qr.imageUrl)}
                            alt={`QR Code for ${qr.area}`}
                            className={`w-32 h-32 mx-auto border border-gray-200 rounded-xl transition-transform ${
                              isSelecting && selectedIds.includes(qr.id) ? 'scale-[0.97]' : ''
                            }`}
                          />
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="space-y-1">
                            <h3 className="font-semibold text-gray-900">{qr.area}</h3>
                            <p className="text-sm text-gray-500">{qr.customer}</p>
                          </div>
                          <div className="flex gap-2 justify-center flex-wrap">
                            <Badge className="bg-blue-100 text-blue-700 rounded-full px-3 py-1">{qr.customer}</Badge>
                            <Badge className={`${getTypeColor(qr.subArea)} rounded-full px-3 py-1`}>{qr.subArea}</Badge>
                          </div>
                        </div>
                        <div className="mt-auto pt-4">
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              className="flex-1 h-9 gap-2 rounded-full text-white transition-all duration-200 hover:shadow-lg hover:scale-[1.02]" 
                              style={{ backgroundColor: '#00339B' }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e3a8a'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#00339B'}
                              onClick={() => handleDownloadQR(qr)}
                            >
                              <Download className="h-3 w-3" />
                              Download
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="w-10 h-9 rounded-full border-red-200 text-red-600 p-0 transition-all duration-200 hover:bg-red-100 hover:border-red-400 hover:text-red-700 hover:shadow-lg hover:scale-[1.05]"
                              onClick={() => handleDeleteQR(qr.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredQRCodes.map((qr) => (
                  <div
                    key={qr.id}
                    className={`flex items-center gap-4 p-4 border border-gray-200 rounded-2xl hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#00339B] ${
                      isSelecting && selectedIds.includes(qr.id) ? 'ring-2 ring-[#00339B]/60' : ''
                    }`}
                    tabIndex={isSelecting ? 0 : -1}
                    onClick={(event) => handleSelectableClick(event, qr.id)}
                    onKeyDown={(event) => handleSelectableKeyDown(event, qr.id)}
                    role={isSelecting ? 'button' : undefined}
                    aria-pressed={isSelecting ? selectedIds.includes(qr.id) : undefined}
                  >
                    <div className="relative">
                      {isSelecting && (
                        <div className="absolute left-1 top-1">
                          <Checkbox
                            checked={selectedIds.includes(qr.id)}
                            onCheckedChange={() => handleToggleSelection(qr.id)}
                            className="h-5 w-5 rounded-lg border-2 border-white shadow"
                          />
                        </div>
                      )}
                      <img
                        src={qr.imageUrl || generateQRCodeImage(qr.qrCodeData, qr.imageUrl)}
                        alt={`QR Code for ${qr.area}`}
                        className={`w-16 h-16 border border-gray-200 rounded-xl transition-transform ${
                          isSelecting && selectedIds.includes(qr.id) ? 'scale-[0.96]' : ''
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{qr.area}</h3>
                        <Badge className="bg-blue-100 text-blue-700 rounded-full px-3 py-1">{qr.customer}</Badge>
                        <Badge className={`${getTypeColor(qr.subArea)} rounded-full px-3 py-1`}>{qr.subArea}</Badge>
                      </div>
                      <p className="text-sm text-gray-600">{qr.floor} • {qr.category}</p>
                      <p className="text-xs text-gray-400 font-mono">{qr.qrCodeData}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        className="h-9 gap-2 rounded-full text-white transition-all duration-200 hover:shadow-lg hover:scale-[1.02]" 
                        style={{ backgroundColor: '#00339B' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e3a8a'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#00339B'}
                        onClick={() => handleDownloadQR(qr)}
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="w-10 h-9 rounded-full border-red-200 text-red-600 p-0 transition-all duration-200 hover:bg-red-100 hover:border-red-400 hover:text-red-700 hover:shadow-lg hover:scale-[1.05]"
                        onClick={() => handleDeleteQR(qr.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Sidebar07Layout>
  )
}
