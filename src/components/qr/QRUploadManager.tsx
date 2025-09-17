import React, { useState } from 'react'
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

interface UploadedFile {
  name: string
  size: number
  status: 'pending' | 'processing' | 'completed' | 'error'
  qrCount?: number
  customer?: string
  error?: string
}

interface QRUploadManagerProps {
  onUploadComplete: (files: UploadedFile[]) => void
}

export const QRUploadManager: React.FC<QRUploadManagerProps> = ({ onUploadComplete }) => {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    const zipFiles = selectedFiles.filter(file => 
      file.name.toLowerCase().endsWith('.zip')
    )

    if (zipFiles.length === 0) {
      return
    }

    const newFiles: UploadedFile[] = zipFiles.map(file => ({
      name: file.name,
      size: file.size,
      status: 'pending'
    }))

    setFiles(newFiles)
  }

  const processZipFiles = async () => {
    setUploading(true)
    setUploadProgress(0)

    const processedFiles: UploadedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      
      // Update status to processing
      setFiles(prev => prev.map(f => 
        f.name === file.name ? { ...f, status: 'processing' } : f
      ))

      try {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        // Mock processing results - in reality, you'd extract and process the zip
        const mockResults = {
          'sunward-park-qr-codes.zip': { customer: 'Sunward Park', qrCount: 45 },
          'box-office-qr-codes.zip': { customer: 'Box Office', qrCount: 32 },
          'retail-center-qr-codes.zip': { customer: 'Retail Center', qrCount: 67 },
          'corporate-office-qr-codes.zip': { customer: 'Corporate Office', qrCount: 28 },
          'shopping-mall-qr-codes.zip': { customer: 'Shopping Mall', qrCount: 89 }
        }

        const fileName = file.name.toLowerCase()
        const result = Object.entries(mockResults).find(([key]) => 
          fileName.includes(key.split('-')[0])
        )?.[1] || { customer: 'Unknown Customer', qrCount: Math.floor(Math.random() * 50) + 10 }

        const processedFile: UploadedFile = {
          ...file,
          status: 'completed',
          customer: result.customer,
          qrCount: result.qrCount
        }

        processedFiles.push(processedFile)

        // Update status to completed
        setFiles(prev => prev.map(f => 
          f.name === file.name ? processedFile : f
        ))

      } catch (error) {
        const errorFile: UploadedFile = {
          ...file,
          status: 'error',
          error: 'Failed to process zip file'
        }

        processedFiles.push(errorFile)

        setFiles(prev => prev.map(f => 
          f.name === file.name ? errorFile : f
        ))
      }

      setUploadProgress(((i + 1) / files.length) * 100)
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
    <Card className="card-modern border-0 shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <Upload className="h-6 w-6 text-blue-600" />
          Upload QR Code Collections
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Area */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
          <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Upload Customer QR Code Collections
          </h3>
          <p className="text-gray-600 mb-4">
            Select ZIP files containing QR codes organized by customer areas
          </p>
          <Input
            type="file"
            accept=".zip"
            multiple
            onChange={handleFileSelection}
            className="hidden"
            id="zip-upload"
          />
          <Button asChild className="gap-2">
            <label htmlFor="zip-upload" className="cursor-pointer">
              <Folder className="h-4 w-4" />
              Select ZIP Files
            </label>
          </Button>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900">Selected Files ({files.length})</h4>
              {!uploading && files.some(f => f.status === 'pending') && (
                <Button onClick={processZipFiles} className="gap-2">
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
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}

            <div className="space-y-3">
              {files.map((file, index) => (
                <div key={index} className="flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
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
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>Instructions:</strong> Upload ZIP files containing QR code images. 
            Each ZIP should be organized by customer with folders for different areas 
            (e.g., Reception, Toilets, Kitchen, etc.). The system will automatically 
            categorize and organize the QR codes by customer and area type.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
