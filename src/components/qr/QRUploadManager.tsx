import React, { useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Progress } from '../ui/progress'
import { Alert, AlertDescription } from '../ui/alert'
import { 
  Upload,
  FileArchive, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Folder
} from 'lucide-react'
import QrScanner from 'qr-scanner'
import JSZip from 'jszip'
import { supabase } from '../../services/supabase'
import { QRService, QRCodeData } from '../../services/qrService'

interface UploadedFile {
  name: string
  size: number
  status: 'pending' | 'processing' | 'completed' | 'error'
  qrCount?: number
  customer?: string
  error?: string
  file: File
}

interface QRUploadManagerProps {
  onUploadComplete: (files: UploadedFile[]) => void
}

export const QRUploadManager: React.FC<QRUploadManagerProps> = ({ onUploadComplete }) => {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const directoryInputRef = useRef<HTMLInputElement>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const sanitizeSegment = (value: string | undefined) => {
    return (value || 'unknown')
      .toString()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
  }

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    if (selectedFiles.length === 0) return

    const newFiles: UploadedFile[] = selectedFiles
      .filter(f => /\.(png|jpe?g|webp|gif|bmp|zip)$/i.test(f.name))
      .map(file => ({
      name: file.name,
      size: file.size,
      status: 'pending',
      file
    }))

    setFiles(newFiles)
    // Auto-start processing after selection using the concrete list
    setTimeout(() => {
      void processSelectedFiles(newFiles)
    }, 0)
  }

  const processSelectedFiles = async (selectedList: UploadedFile[]) => {
    setUploading(true)
    setErrorMsg(null)
    setUploadProgress(0)

    const processedFiles: UploadedFile[] = []

    for (let i = 0; i < selectedList.length; i++) {
      const entry = selectedList[i]
      const fileObj = entry.file
      
      // Update status to processing
      setFiles(prev => prev.map(f => 
        f.name === entry.name ? { ...f, status: 'processing' } : f
      ))

      try {
        let qrData: QRCodeData | null = null

        // If ZIP: read first image file inside and extract the QR
        if (fileObj.name.toLowerCase().endsWith('.zip')) {
          const zip = await JSZip.loadAsync(fileObj)
          const firstImage = Object.values(zip.files).find(f => !f.dir && /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name))
          if (!firstImage) {
            throw new Error('No images found in ZIP')
          }
          const imageBlob = await firstImage.async('blob')
          const scanResult = await QrScanner.scanImage(imageBlob as Blob, { returnDetailedScanResult: true }).catch(() => null)
          const qrText = (scanResult && (scanResult as any).data) || (scanResult as any) || null
          if (qrText) {
            qrData = QRService.parseQRCode(qrText as string)
          }
        } else {
          // Single image file (PNG/JPG)
          const scanResult = await QrScanner.scanImage(fileObj as unknown as Blob, { returnDetailedScanResult: true }).catch(() => null)
          const qrText = (scanResult && (scanResult as any).data) || (scanResult as any) || null
          if (qrText) {
            qrData = QRService.parseQRCode(qrText as string)
          }
        }

        if (!qrData) throw new Error('No QR found in image')

        // Upload image to Supabase Storage
        const bucket = supabase.storage.from('qr-codes')
        // If the user selected folders, try to infer folder path from file name (webkitRelativePath)
        const rel = (fileObj as any).webkitRelativePath || ''
        const parts = rel ? rel.split('/') : []
        const customerFromPath = parts.length >= 3 ? parts[parts.length - 3] : undefined
        const areaFromPath = parts.length >= 2 ? parts[parts.length - 2] : undefined
        const safeCustomer = sanitizeSegment(customerFromPath || qrData.customerName)
        const safeArea = sanitizeSegment(areaFromPath || (qrData.metadata?.areaName || qrData.metadata?.siteName || qrData.type))
        const sanitizedName = sanitizeSegment(fileObj.name)
        const path = `${safeCustomer}/${safeArea}/${qrData.id}-${sanitizedName}`
        const { error: uploadError } = await bucket.upload(path, fileObj, { upsert: true })
        if (uploadError) throw uploadError

        const { data: publicUrlData } = bucket.getPublicUrl(path)
        const publicUrl = publicUrlData?.publicUrl || path

        // Save metadata to database
        const { error: insertError } = await supabase
          .from('building_qr_codes')
          .upsert({
            qr_code_id: qrData.id,
            customer_name: qrData.customerName || 'Unknown',
            building_area: (qrData.metadata?.areaName || qrData.metadata?.siteName || safeArea || 'Area'),
            area_description: qrData.type,
            qr_code_url: JSON.stringify(qrData),
            qr_code_image_path: publicUrl,
            is_active: true,
            created_at: new Date().toISOString()
          }, { onConflict: 'qr_code_id' })

        if (insertError) {
          throw insertError
        }

        const processedFile: UploadedFile = {
          ...entry,
          status: 'completed',
          customer: qrData.customerName || 'Unknown',
          qrCount: 1
        }

        processedFiles.push(processedFile)

        // Update status to completed
        setFiles(prev => prev.map(f => f.name === entry.name ? processedFile : f))

      } catch (error: any) {
        console.error('Upload error:', error)
        setErrorMsg(error?.message || 'Upload failed')
        const errorFile: UploadedFile = {
          ...entry,
          status: 'error',
          error: error?.message || 'Failed to process file'
        }

        processedFiles.push(errorFile)

        setFiles(prev => prev.map(f => f.name === entry.name ? errorFile : f))
      }

      setUploadProgress(((i + 1) / selectedList.length) * 100)
    }

    setUploading(false)
    onUploadComplete(processedFiles)
  }

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return <FileArchive className="h-5 w-5 text-gray-400" />
      case 'processing':
        return <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />
      case 'error':
        return <XCircle className="h-5 w-5 text-red-600" />
    }
  }

  const getStatusColor = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return 'text-gray-600'
      case 'processing':
        return 'text-blue-600'
      case 'completed':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="flex items-center justify-center gap-3 text-xl font-semibold text-gray-900 mb-2">
          <Upload className="h-6 w-6 text-blue-600" />
          Upload QR Code Collections
        </h2>
      </div>
        {/* Upload Area */}
        <div className="rounded-3xl p-8 text-center bg-gray-50 border border-gray-200">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-gray-300">
            <Upload className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Upload Customer QR Code Collections
          </h3>
          <p className="text-gray-600 mb-6">
            Select a folder of PNG/JPG images (or ZIPs). Folder structure: Customer/Area/Images
          </p>
          <input
            ref={directoryInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.zip"
            multiple
            onChange={handleFileSelection}
            className="hidden"
            id="zip-upload"
            // @ts-ignore – enable folder selection in supported browsers
            webkitdirectory="true"
            // @ts-ignore
            directory="true"
          />
          <Button asChild className="gap-2 rounded-full text-white px-5" style={{ backgroundColor: '#00339B' }}>
            <label htmlFor="zip-upload" className="cursor-pointer">
              <Folder className="h-4 w-4" />
              Select Folder
            </label>
          </Button>
        </div>

        {/* Errors */}
        {errorMsg && (
          <Alert className="border-red-200 bg-red-50 rounded-2xl">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700">{errorMsg}</AlertDescription>
          </Alert>
        )}

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900">Selected Files ({files.length})</h4>
              {!uploading && files.some(f => f.status === 'pending') && (
                <Button onClick={() => processSelectedFiles(files)} className="gap-2">
                  <Upload className="h-4 w-4" />
                  Process Files
                </Button>
              )}
            </div>

            {uploading && (
                <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Processing files...</span>
                  <span className="text-gray-600">{Math.round(uploadProgress)}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2 rounded-full" />
              </div>
            )}

            <div className="space-y-3">
              {files.map((file, index) => (
                <div key={index} className="flex items-center gap-4 p-4 border border-gray-200 rounded-2xl hover:bg-gray-50 transition-colors">
                  {getStatusIcon(file.status)}
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h5 className="font-medium text-gray-900">{file.name}</h5>
                      <span className={`text-sm font-medium capitalize ${getStatusColor(file.status)}`}>
                        {file.status}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-600">
                      Size: {formatFileSize(file.size)}
                      {file.customer && (
                        <span className="ml-4">Customer: {file.customer}</span>
                      )}
                      {file.qrCount && (
                        <span className="ml-4">QR Codes: {file.qrCount}</span>
                      )}
                    </div>
                    
                    {file.error && (
                      <Alert className="mt-2 border-red-200 bg-red-50">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <AlertDescription className="text-red-600">
                          {file.error}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Instructions */}
        <Alert className="border-blue-100 bg-blue-50 rounded-2xl">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>Instructions:</strong> Choose a folder containing QR images. Use folders to organize by
            customer and area, for example: <em>Avtrade/Toilets/*.png</em>. ZIP files are also accepted.
          </AlertDescription>
        </Alert>
    </div>
  )
}
