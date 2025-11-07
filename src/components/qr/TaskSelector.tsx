import React, { useState, useRef } from 'react'
import { CheckCircle2, Camera, Folder, ArrowLeft, Trash2, RotateCcw, Check, X, Flag, Loader2 } from 'lucide-react'
import { QRCodeData, AreaType, QRService, TaskSelection, TaskDefinition } from '../../services/qrService'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { saveDraft as saveLocalDraft, clearDraft } from '../../lib/offlineStore'

export interface TaskSubmissionSummary {
  taskCount?: number
  areaName?: string
}

interface TaskCompletionProps {
  qrData: QRCodeData
  cleanerId: string
  cleanerName: string
  onWorkSubmitted?: (summary?: TaskSubmissionSummary) => void
  onClockOut?: () => void
  onCancel?: () => void
  initialState?: {
    qrCodeId?: string
    currentTaskIndex: number
    taskCompletions: TaskCompletion[]
    confirmedPhotos: Record<string, boolean>
  }
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
  onCancel,
  initialState
}) => {
  const [taskCompletions, setTaskCompletions] = useState<TaskCompletion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPhotoCapture, setShowPhotoCapture] = useState<string | null>(null)
  const [confirmedPhotos, setConfirmedPhotos] = useState<Record<string, boolean>>({})
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Detect area type from QR data
  const areaType = QRService.detectAreaType(qrData)
  const [tasks, setTasks] = useState<TaskDefinition[]>([])
  const [tasksLoading, setTasksLoading] = useState<boolean>(true)
  const [tasksError, setTasksError] = useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const loadTasks = async () => {
      setTasksLoading(true)
      setTasksError(null)
      try {
        const remoteTasks = await QRService.fetchTasksForQrArea(qrData)
        const resolved = remoteTasks.length > 0 ? remoteTasks : QRService.getTasksForArea(areaType)
        if (!cancelled) {
          setTasks(resolved)
        }
      } catch (err) {
        console.error('Failed to load tasks for area:', err)
        if (!cancelled) {
          setTasks(QRService.getTasksForArea(areaType))
          setTasksError('Could not load custom tasks for this area. Showing default checklist instead.')
        }
      } finally {
        if (!cancelled) {
          setTasksLoading(false)
        }
      }
    }

    loadTasks()

    return () => {
      cancelled = true
    }
  }, [qrData.id, qrData.customerName, qrData.metadata?.areaName, areaType])

  React.useEffect(() => {
    if (tasksLoading) return

    if (tasks.length === 0) {
      setTaskCompletions([])
      setConfirmedPhotos({})
      setCurrentIndex(0)
      return
    }

    const hasInitialState = Boolean(initialState && (!initialState.qrCodeId || initialState.qrCodeId === qrData.id))
    const initialMap = hasInitialState
      ? new Map((initialState?.taskCompletions || []).map(tc => [tc.taskId, tc]))
      : null

    const nextCompletions = tasks.map(task => {
      if (initialMap?.has(task.id)) {
        return initialMap.get(task.id) as TaskCompletion
      }
      return { taskId: task.id, completed: false, photos: [] }
    })

    setTaskCompletions(nextCompletions)

    if (initialMap) {
      setConfirmedPhotos(initialState?.confirmedPhotos || {})
      const maxIndex = Math.max(nextCompletions.length - 1, 0)
      const nextIndex = Math.min(Math.max(initialState?.currentTaskIndex || 0, 0), maxIndex)
      setCurrentIndex(nextIndex)
    } else {
      setConfirmedPhotos({})
      setCurrentIndex(0)
    }
  }, [tasks, tasksLoading, initialState, qrData.id])

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

  const getDisplayArea = (): string => {
    return qrData.metadata?.areaName || getAreaDisplayName(areaType)
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
        prev.map(completion => {
          if (completion.taskId !== taskId) return completion
          // Replace first photo (single-photo per task UX) and mark completed
          const newPhotos = [photo]
          return { ...completion, completed: true, photos: newPhotos }
        })
      )
      setConfirmedPhotos(prev => ({ ...prev, [taskId]: false }))
      setShowPhotoCapture(null)
    } catch (err) {
      console.error('Error processing photo:', err)
      setError('Failed to process photo. Please try again.')
    }
  }

  const clearPhoto = (taskId: string) => {
    setTaskCompletions(prev =>
      prev.map(completion => (
        completion.taskId === taskId ? { ...completion, completed: false, photos: [] } : completion
      ))
    )
    setConfirmedPhotos(prev => ({ ...prev, [taskId]: false }))
  }

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const startCamera = async (taskId: string) => {
    try {
      setShowPhotoCapture(taskId)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      setCameraStream(stream)
      setIsCameraOpen(true)
    } catch (err) {
      console.error('Camera start failed:', err)
      setError('Unable to access camera. Please allow camera permission and try again.')
    }
  }

  const stopCamera = () => {
    try { cameraStream?.getTracks().forEach(t => t.stop()) } catch {}
    setCameraStream(null)
    setIsCameraOpen(false)
  }

  const captureFromCamera = async () => {
    if (!videoRef.current || !showPhotoCapture) return
    try {
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      const width = video.videoWidth || 1280
      const height = video.videoHeight || 720
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context not available')
      ctx.drawImage(video, 0, 0, width, height)
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve as BlobCallback, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Failed to capture photo')
      const file = new File([blob], 'task-photo.jpg', { type: 'image/jpeg' })
      await handlePhotoCapture(showPhotoCapture, file)
    } catch (err) {
      console.error('Capture failed:', err)
      setError('Failed to capture photo. Please try again.')
    } finally {
      stopCamera()
    }
  }

  // Attach stream to video when ready and ensure cleanup on unmount
  React.useEffect(() => {
    if (isCameraOpen && cameraStream && videoRef.current) {
      const video = videoRef.current
      video.muted = true
      video.setAttribute('playsinline', 'true')
      video.autoplay = true
      try { ;(video as any).srcObject = cameraStream } catch { /* no-op */ }
      const playVideo = async () => { try { await video.play() } catch {} }
      if (video.readyState >= 2) playVideo()
      else video.onloadedmetadata = () => playVideo()
    }
    return () => { try { cameraStream?.getTracks().forEach(t => t.stop()) } catch {} }
  }, [isCameraOpen, cameraStream])

  const handleFileUpload = (taskId: string) => {
    setShowPhotoCapture(taskId)
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleWorkSubmission = async () => {
    const completedTasks = taskCompletions.filter(tc => (tc.photos?.length || 0) > 0)
    if (completedTasks.length !== tasks.length) {
      setError('Please add a photo for each task to finish.')
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
        // Finalize and clear any persisted drafts because the area is done
        try { await QRService.finalizeRemoteDraft(cleanerId) } catch {}
        try { await clearDraft() } catch {}
        onWorkSubmitted?.({
          taskCount: tasks.length,
          areaName: getDisplayArea()
        })
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

  const confirmCurrentPhoto = () => {
    if (!currentTask) return
    // Mark current task confirmed; do NOT auto-advance
    setConfirmedPhotos(prev => ({ ...prev, [currentTask.id]: true }))
  }

  const currentTask = tasks[currentIndex] || tasks[0]
  const currentCompletion = taskCompletions.find(tc => currentTask && tc.taskId === currentTask.id)
  const currentHasPhoto = (currentCompletion?.photos?.length || 0) > 0
  const completedTasksCount = taskCompletions.filter(tc => (tc.photos?.length || 0) > 0).length
  const confirmedCount = tasks.filter(t => confirmedPhotos[t.id]).length
  const confirmedBeforeCount = tasks
    .slice(0, Math.max(0, currentIndex))
    .filter(t => confirmedPhotos[t.id])
    .length
  const progressPercent = Math.round((confirmedBeforeCount / Math.max(tasks.length, 1)) * 100)

  // Persist draft (local + remote-light) whenever key state changes
  React.useEffect(() => {
    if (tasksLoading || !tasks.length) return

    const draft = {
      cleanerId,
      qrCodeId: qrData.id,
      areaType,
      step: 'tasks',
      currentTaskIndex: currentIndex,
      state: {
        qrData,
        taskCompletions,
        confirmedPhotos
      }
    }
    saveLocalDraft(draft).catch(() => {})
    const light = {
      ...draft,
      state: {
        qrData: { ...qrData, metadata: { areaName: qrData.metadata?.areaName } },
        taskCompletions: taskCompletions.map(tc => ({ taskId: tc.taskId, completed: tc.completed })),
        confirmedPhotos
      }
    }
    QRService.saveRemoteDraft(light)
  }, [taskCompletions, confirmedPhotos, currentIndex, tasksLoading, tasks.length])

  if (tasksLoading) {
    return (
      <div className="w-full max-w-md mx-auto space-y-4 text-center">
        <div className="flex justify-center">
          <div className="flex items-center gap-3 rounded-3xl border border-blue-100 bg-blue-50 px-6 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-[#00339B]" />
            <span className="text-sm font-medium text-[#00339B]">Loading tasks...</span>
          </div>
        </div>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="w-full max-w-md mx-auto space-y-4 text-center">
        <Alert>
          <AlertDescription>
            No specific tasks defined for this area yet. Your scan has been logged successfully.
          </AlertDescription>
        </Alert>
        <Button onClick={onCancel} className="w-full rounded-full text-white" style={{ backgroundColor: '#00339B' }}>
          Continue
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-lg mx-auto space-y-6">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            handlePhotoCapture(currentTask.id, e.target.files[0])
          }
        }}
      />
      {/* inline camera uses getUserMedia; gallery input above */}

      {/* Top progress */}
      <div className="space-y-3">
        <div className="text-center text-sm text-gray-600">working on: {getDisplayArea()}</div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full" style={{ width: `${progressPercent}%`, backgroundColor: '#00339B', transition: 'width 400ms ease' }} />
          </div>
          <Flag className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* Task title */}
      <div className="text-center space-y-2">
        <div className="text-sm text-gray-500">Task {currentIndex + 1}/{tasks.length}</div>
        <h2 className="text-3xl font-bold text-gray-900">{currentTask.name}</h2>
      </div>

      {/* Photo frame with in-frame capture options */}
      <div className="space-y-4">
        <div className="relative rounded-3xl overflow-hidden border-2 border-blue-200 bg-blue-50" style={{ aspectRatio: '4 / 3' }}>
          {currentHasPhoto && !isCameraOpen && (
            <img src={currentCompletion?.photos?.[0]?.photo} alt="Task" className="w-full h-full object-cover" />
          )}

          {/* In-frame controls */}
          <div className={`absolute inset-0 ${isCameraOpen ? '' : 'flex items-center'} ${isCameraOpen ? '' : (currentHasPhoto ? 'justify-end pb-4 items-end' : 'justify-center items-center')}`}>
            {isCameraOpen ? (
              <div className="relative w-full h-full">
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay style={{ transform: 'scaleX(1) rotate(0deg)' }} />
                {/* Capture UI: left cancel (X), centered capture button */}
                <button
                  aria-label="Close camera"
                  onClick={stopCamera}
                  className="absolute bottom-4 left-4 h-12 w-12 rounded-full bg-white/95 border border-blue-200 shadow flex items-center justify-center hover:bg-white"
                >
                  <X className="h-5 w-5" style={{ color: '#00339B' }} />
                </button>
                <button
                  aria-label="Take photo"
                  onClick={captureFromCamera}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 h-14 w-14 rounded-full bg-white/95 border border-blue-200 shadow flex items-center justify-center hover:bg-white"
                >
                  <Camera className="h-6 w-6" style={{ color: '#00339B' }} />
                </button>
              </div>
            ) : (
              <>
                 {!currentHasPhoto ? (
                   <div className="w-full h-full flex items-center justify-center px-8">
                     <div className="grid w-full grid-cols-[1fr_auto_1fr] items-end gap-16">
                       <div className="flex flex-col items-center justify-end justify-self-end">
                         <button
                           onClick={() => startCamera(currentTask.id)}
                           className="h-20 w-20 rounded-full bg-white/95 border border-blue-200 shadow flex items-center justify-center hover:bg-white"
                         >
                           <Camera className="h-8 w-8" style={{ color: '#00339B' }} />
                         </button>
                         <span className="mt-3 text-[13px] text-gray-400">take photo</span>
                       </div>
                       <span className="self-center justify-self-center text-2xl font-medium select-none" style={{ color: '#00339B' }}>or</span>
                       <div className="flex flex-col items-center justify-end justify-self-start">
                         <button
                           onClick={() => fileInputRef.current?.click()}
                           className="h-20 w-20 rounded-full bg-white/95 border border-blue-200 shadow flex items-center justify-center hover:bg-white"
                         >
                           <Folder className="h-8 w-8" style={{ color: '#00339B' }} />
                         </button>
                        <span className="mt-3 text-[13px] text-gray-400 hidden sm:block">select from gallery</span>
                        <span className="mt-3 text-[13px] text-gray-400 sm:hidden">from gallery</span>
                       </div>
                     </div>
                   </div>
                ) : (
                  <div className="absolute inset-0">
                    <div className="absolute bottom-4 left-4">
                      <button
                        aria-label="Delete photo"
                        onClick={() => clearPhoto(currentTask.id)}
                        className="h-12 w-12 rounded-full bg-white/95 border border-blue-200 shadow hover:bg-white flex items-center justify-center"
                      >
                        <Trash2 className="h-5 w-5" style={{ color: '#00339B' }} />
                      </button>
                    </div>
                    {!confirmedPhotos[currentTask.id] && (
                      <div className="absolute bottom-4 right-4 flex gap-3">
                        <button
                          aria-label="Retake photo"
                          onClick={() => startCamera(currentTask.id)}
                          className="h-12 w-12 rounded-full bg-white/95 border border-blue-200 shadow hover:bg-white flex items-center justify-center"
                        >
                          <RotateCcw className="h-5 w-5" style={{ color: '#00339B' }} />
                        </button>
                        <button
                          aria-label="Confirm photo"
                          onClick={confirmCurrentPhoto}
                          className="h-12 w-12 rounded-full bg-white/95 border border-blue-200 shadow hover:bg-white flex items-center justify-center"
                        >
                          <Check className="h-5 w-5" style={{ color: '#00339B' }} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {(error || tasksError) && (
        <Alert variant="destructive" className="rounded-xl">
          <AlertDescription>{error || tasksError}</AlertDescription>
        </Alert>
      )}

      {/* Bottom navigation */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => {
            if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
            else onCancel?.()
          }}
          className="flex-1 rounded-full border-blue-200 text-blue-700 hover:bg-blue-50"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        {currentIndex < tasks.length - 1 ? (
          <Button
            onClick={() => {
              // Animate bar to include this task then advance after animation
              if (!currentHasPhoto) return
              const animateTo = Math.round(((confirmedBeforeCount + 1) / Math.max(tasks.length, 1)) * 100)
              const bar = document.createElement('div')
              // No-op: width transition handled by CSS above since we derive from confirmedBeforeCount
              // Delay page advance slightly to let animation play
              setTimeout(() => setCurrentIndex(currentIndex + 1), 420)
            }}
            disabled={!currentHasPhoto}
            className="flex-1 rounded-full text-white"
            style={{ backgroundColor: '#00339B' }}
          >
            Continue
          </Button>
        ) : (
          <Button
            onClick={handleWorkSubmission}
            disabled={isSubmitting || completedTasksCount !== tasks.length || !currentHasPhoto}
            className="flex-1 rounded-full text-white"
            style={{ backgroundColor: '#00339B' }}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Finishing...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Finish
              </div>
            )}
          </Button>
        )}
      </div>

      <div className="text-center">
        <p className="text-xs text-gray-500">Photos are required to continue</p>
      </div>
    </div>
  )
}
