import React, { useState, useRef } from 'react'
import { CheckCircle2, Clock, MapPin, Camera, Upload, X, Image, ChevronDown, ChevronUp, ArrowLeft, ArrowRight } from 'lucide-react'
import { QRCodeData, AreaType, TaskDefinition, QRService, TaskSelection } from '../../services/qrService'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { Alert, AlertDescription } from '../ui/alert'

interface TaskCompletionProps {
  qrData: QRCodeData
  cleanerId: string
  cleanerName: string
  onWorkSubmitted?: () => void
  onClockOut?: () => void
  onCancel?: () => void
}

interface TaskPhoto {
  taskId: string
  photo: string // base64 data URL
  timestamp: string
  id?: string
}

interface TaskCompletion {
  taskId: string
  completed: boolean
  photos: TaskPhoto[]
}

export const TaskSelector: React.FC<TaskCompletionProps> = ({
  qrData,
  cleanerId,
  cleanerName,
  onWorkSubmitted,
  onClockOut,
  onCancel
}) => {
  const [taskCompletions, setTaskCompletions] = useState<TaskCompletion[]>([])
  const [openTaskIds, setOpenTaskIds] = useState<Record<string, boolean>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isClockingOut, setIsClockingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPhotoCapture, setShowPhotoCapture] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Detect area type from QR data
  const areaType = QRService.detectAreaType(qrData)
  const tasks = QRService.getTasksForArea(areaType)

  // Initialize task completions on mount
  React.useEffect(() => {
    const initialCompletions = tasks.map(task => ({
      taskId: task.id,
      completed: false,
      photos: []
    }))
    setTaskCompletions(initialCompletions)
  }, [])

  const getAreaDisplayName = (area: AreaType): string => {
    switch (area) {
      case 'BATHROOMS_ABLUTIONS': return 'Bathrooms / Ablutions'
      case 'ADMIN_OFFICE': return 'Admin / Office Areas'
      case 'GENERAL_AREAS': return 'General Areas'
      case 'WAREHOUSE_INDUSTRIAL': return 'Warehouse / Industrial Areas'
      case 'KITCHEN_CANTEEN': return 'Kitchen / Canteen Areas'
      case 'RECEPTION_COMMON': return 'Reception / Common Spaces'
      default: return 'Unknown Area'
    }
  }

  const getAreaColor = (area: AreaType): string => {
    switch (area) {
      case 'BATHROOMS_ABLUTIONS': return 'bg-blue-500'
      case 'ADMIN_OFFICE': return 'bg-purple-500'
      case 'GENERAL_AREAS': return 'bg-green-500'
      case 'WAREHOUSE_INDUSTRIAL': return 'bg-orange-500'
      case 'KITCHEN_CANTEEN': return 'bg-red-500'
      case 'RECEPTION_COMMON': return 'bg-indigo-500'
      default: return 'bg-gray-500'
    }
  }

  const toggleTaskCompletion = (taskId: string) => {
    setTaskCompletions(prev => 
      prev.map(completion => 
        completion.taskId === taskId 
          ? { ...completion, completed: !completion.completed }
          : completion
      )
    )
  }

  const toggleOpen = (taskId: string) => {
    setOpenTaskIds(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  const handlePhotoCapture = async (taskId: string, file: File) => {
    try {
      const base64 = await convertFileToBase64(file)
      const photo: TaskPhoto = {
        taskId,
        photo: base64,
        timestamp: new Date().toISOString(),
        id: `${taskId}-${Date.now()}`
      }

      setTaskCompletions(prev =>
        prev.map(completion =>
          completion.taskId === taskId
            ? { ...completion, photos: [...(completion.photos || []), photo] }
            : completion
        )
      )
      setShowPhotoCapture(null)
    } catch (err) {
      console.error('Error processing photo:', err)
      setError('Failed to process photo. Please try again.')
    }
  }

  const removePhoto = (taskId: string, photoId?: string, index?: number) => {
    setTaskCompletions(prev =>
      prev.map(completion => {
        if (completion.taskId !== taskId) return completion
        const photos = [...(completion.photos || [])]
        let newPhotos
        if (photoId) newPhotos = photos.filter(p => p.id !== photoId)
        else if (typeof index === 'number') { photos.splice(index, 1); newPhotos = photos }
        else newPhotos = photos
        return { ...completion, photos: newPhotos }
      })
    )
  }

  const movePhoto = (taskId: string, fromIndex: number, toIndex: number) => {
    setTaskCompletions(prev =>
      prev.map(completion => {
        if (completion.taskId !== taskId) return completion
        const photos = [...(completion.photos || [])]
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= photos.length || toIndex >= photos.length) return completion
        const [moved] = photos.splice(fromIndex, 1)
        photos.splice(toIndex, 0, moved)
        return { ...completion, photos }
      })
    )
  }

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleCameraCapture = (taskId: string) => {
    setShowPhotoCapture(taskId)
    if (cameraInputRef.current) {
      cameraInputRef.current.click()
    }
  }

  const handleFileUpload = (taskId: string) => {
    setShowPhotoCapture(taskId)
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleWorkSubmission = async () => {
    const completedTasks = taskCompletions.filter(tc => tc.completed)
    
    if (completedTasks.length === 0) {
      setError('Please complete at least one task before submitting.')
      return
    }

    // Check if all completed tasks have photos
    const tasksWithoutPhotos = completedTasks.filter(tc => !(tc.photos && tc.photos.length > 0))
    if (tasksWithoutPhotos.length > 0) {
      setError('Please take photos for all completed tasks before submitting.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const taskSelection: TaskSelection = {
        cleanerId,
        qrCodeId: qrData.id,
        areaType,
        selectedTasks: completedTasks.map(tc => tc.taskId),
        timestamp: new Date().toISOString(),
        completedTasks: completedTasks.map(tc => tc.taskId)
      }

      // Prepare photos for saving
      const photos = completedTasks.flatMap(tc =>
        (tc.photos || []).map(p => ({
          taskId: tc.taskId,
          photo: p.photo,
          timestamp: p.timestamp
        }))
      )

      const success = await QRService.saveTaskSelection(taskSelection, photos)

      if (success) {
        onWorkSubmitted?.()
      } else {
        setError('Failed to submit work. Please try again.')
      }
    } catch (err) {
      console.error('Error submitting work:', err)
      setError('An error occurred while submitting your work.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClockOut = async () => {
    setIsClockingOut(true)
    setError(null)

    try {
      // Process clock out QR scan
      const clockOutData = {
        ...qrData,
        type: 'CLOCK_OUT' as const,
        metadata: {
          ...qrData.metadata,
          action: 'clock_out',
          timestamp: new Date().toISOString()
        }
      }

      let location: { latitude: number; longitude: number } | undefined
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              enableHighAccuracy: true
            })
          })
          location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }
        } catch (geoError) {
          console.warn('Could not get location:', geoError)
        }
      }

      const result = await QRService.processQRScan(clockOutData, cleanerId, cleanerName, location)
      
      if (result.success) {
        onClockOut?.()
      } else {
        setError(result.message || 'Failed to clock out. Please try again.')
      }
    } catch (err) {
      console.error('Error clocking out:', err)
      setError('An error occurred while clocking out.')
    } finally {
      setIsClockingOut(false)
    }
  }

  const completedTasksCount = taskCompletions.filter(tc => tc.completed).length
  const tasksWithPhotos = taskCompletions.filter(tc => tc.completed && (tc.photos?.length || 0) > 0).length

  if (tasks.length === 0) {
    return (
      <Card className="w-full max-w-md mx-auto rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Area Recognized
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <Alert>
            <AlertDescription>
              No specific tasks defined for this area yet. Your scan has been logged successfully.
            </AlertDescription>
          </Alert>
          <Button onClick={onCancel} className="w-full rounded-full text-white" style={{ backgroundColor: '#00339B' }}>
            Continue
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="w-full max-w-lg mx-auto space-y-4">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0] && showPhotoCapture) {
            handlePhotoCapture(showPhotoCapture, e.target.files[0])
          }
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0] && showPhotoCapture) {
            handlePhotoCapture(showPhotoCapture, e.target.files[0])
          }
        }}
      />

      {/* Header Card */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3 text-lg">
              <div className="p-2 rounded-xl" style={{ backgroundColor: '#e6eefc' }}>
                <CheckCircle2 className="h-5 w-5" style={{ color: '#00339B' }} />
              </div>
              Complete Tasks
            </CardTitle>
            {onCancel && (
              <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 w-8 p-0 rounded-full">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Area Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge className={`${getAreaColor(areaType)} text-white px-3 py-1 rounded-full text-sm`}>
                {getAreaDisplayName(areaType)}
              </Badge>
            </div>
            <p className="text-sm text-gray-600">
              {qrData.metadata?.areaName || qrData.customerName || 'Check off tasks as you complete them and take photos'}
            </p>
          </div>

          {/* Progress Summary */}
          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">
                Progress: {completedTasksCount}/{tasks.length} tasks • {tasksWithPhotos}/{completedTasksCount} photos
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tasks Card */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Task Checklist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.map((task, idx) => {
            const completion = taskCompletions.find(tc => tc.taskId === task.id)
            const isCompleted = completion?.completed || false
            const photoCount = completion?.photos?.length || 0
            const isOpen = !!openTaskIds[task.id]

            return (
              <div
                key={task.id}
                className={`
                  border rounded-2xl p-4 transition-all
                  ${isCompleted 
                    ? 'bg-green-50/80 border-green-200 shadow-sm' 
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <button
                    aria-label={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
                    onClick={() => toggleTaskCompletion(task.id)}
                    className={`mt-1 h-5 w-5 rounded-full border flex items-center justify-center transition-colors
                      ${isCompleted ? 'bg-green-600 border-green-600' : 'bg-white border-gray-300 hover:border-blue-400'}`}
                  >
                    {isCompleted && <span className="block h-2.5 w-2.5 rounded-full bg-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor={task.id} className={`text-[15px] font-medium cursor-pointer block ${isCompleted ? 'text-green-900' : 'text-gray-900'}`}>
                        {idx + 1}. {task.name}
                      </label>
                      <div className="flex items-center gap-2">
                        {isCompleted && (
                          <span className="inline-flex items-center gap-1 text-green-700 text-xs bg-green-100 px-2 py-1 rounded-full">
                            <CheckCircle2 className="h-3 w-3" /> Done
                          </span>
                        )}
                        {isCompleted && (
                          <button
                            onClick={() => toggleOpen(task.id)}
                            aria-label="Toggle photos"
                            className={`h-8 w-8 rounded-full border flex items-center justify-center
                              ${isOpen ? 'border-green-300 bg-green-100 text-green-800' : 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100'}`}
                          >
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1">{task.description}</p>
                    )}
                  </div>
                </div>

                {/* Collapsed summary when a photo exists and panel is closed */}
                {isCompleted && !isOpen && photoCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-green-200/60">
                    <div className="flex items-center gap-2 text-green-700">
                      <Image className="h-4 w-4" />
                      <span className="text-sm font-medium">Photo uploaded ✓</span>
                    </div>
                  </div>
                )}

                {/* Photo upload section for completed tasks */}
                {isCompleted && isOpen && (
                  <div className="mt-4 pt-4 border-t border-green-200/60 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCameraCapture(task.id)}
                        className="flex-1 text-sm rounded-xl border-green-300 text-green-800 bg-green-50 hover:bg-green-100"
                      >
                        <Camera className="h-3 w-3 mr-1" />
                        Camera
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleFileUpload(task.id)}
                        className="flex-1 text-sm rounded-xl border-green-300 text-green-800 bg-green-50 hover:bg-green-100"
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        Upload
                      </Button>
                    </div>

                    {photoCount > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {completion?.photos?.map((p, photoIndex) => (
                          <div key={p.id || photoIndex} className="relative group aspect-square">
                            <img src={p.photo} alt="Task photo" className="w-full h-full object-cover rounded-xl" />
                            {/* top-right circular close - positioned properly on top of image */}
                            <button
                              type="button"
                              aria-label="Remove photo"
                              onClick={() => removePhoto(task.id, p.id, photoIndex)}
                              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors z-10"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <div className="absolute inset-0 rounded-xl flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                              {photoIndex > 0 && (
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={() => movePhoto(task.id, photoIndex, photoIndex - 1)} 
                                  className="h-8 w-8 rounded-full bg-white/95 hover:bg-white shadow-md border border-gray-200"
                                >
                                  <ArrowLeft className="h-3 w-3 text-gray-700" />
                                </Button>
                              )}
                              {photoIndex < photoCount - 1 && (
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={() => movePhoto(task.id, photoIndex, photoIndex + 1)} 
                                  className="h-8 w-8 rounded-full bg-white/95 hover:bg-white shadow-md border border-gray-200"
                                >
                                  <ArrowRight className="h-3 w-3 text-gray-700" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="rounded-xl">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleWorkSubmission}
          disabled={isSubmitting || completedTasksCount === 0 || tasksWithPhotos < completedTasksCount}
          className="flex-1 rounded-full text-white font-medium"
          style={{ backgroundColor: '#00339B' }}
        >
          {isSubmitting ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Submitting...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Submit Work Done ({completedTasksCount} tasks)
            </div>
          )}
        </Button>
        
        <Button 
          variant="outline" 
          onClick={handleClockOut}
          disabled={isClockingOut}
          className="px-6 rounded-full border-red-200 text-red-600 hover:bg-red-50"
        >
          {isClockingOut ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
              Clocking Out...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Clock Out
            </div>
          )}
        </Button>
      </div>

      {/* Help Text */}
      <div className="text-center">
        <p className="text-xs text-gray-500">
          Complete tasks and take photos before submitting your work
        </p>
      </div>
    </div>
  )
}
