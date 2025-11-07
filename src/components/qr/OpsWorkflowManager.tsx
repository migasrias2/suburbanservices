import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Folder,
  MapPin,
  RotateCcw,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClockOutValidator } from './ClockOutValidator'
import { QRService, type OpsInspectionPhoto } from '@/services/qrService'

interface OpsWorkflowManagerProps {
  cleanerId: string
  cleanerName: string
  clockInTime?: string
  siteName?: string
  customerName?: string
  qrCodeId?: string
  onClockOut?: () => void
}

type WorkflowStep = 'welcome' | 'photos' | 'next_action' | 'clock_out'

type CapturedPhoto = OpsInspectionPhoto & { id: string }

const REQUIRED_PHOTO_COUNT = 3

export const OpsWorkflowManager: React.FC<OpsWorkflowManagerProps> = ({
  cleanerId,
  cleanerName,
  clockInTime,
  siteName,
  customerName,
  qrCodeId,
  onClockOut,
}) => {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('welcome')
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeCameraSlot, setActiveCameraSlot] = useState<number | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [pendingUploadSlot, setPendingUploadSlot] = useState<number | null>(null)
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const photosSorted = useMemo(
    () => [...photos].sort((a, b) => a.slot - b.slot),
    [photos],
  )

  const hasAllPhotos = photosSorted.length === REQUIRED_PHOTO_COUNT

  const stopCamera = useCallback(() => {
    try {
      cameraStream?.getTracks().forEach((track) => track.stop())
    } catch {
      // no-op
    }
    setCameraStream(null)
    setActiveCameraSlot(null)
  }, [cameraStream])

  useEffect(() => {
    if (activeCameraSlot !== null && cameraStream && videoRef.current) {
      const video = videoRef.current
      video.muted = true
      video.setAttribute('playsinline', 'true')
      video.autoplay = true
      try {
        ;(video as any).srcObject = cameraStream
      } catch {
        // ignored
      }
      const play = async () => {
        try {
          await video.play()
        } catch {
          // ignored
        }
      }
      if (video.readyState >= 2) {
        void play()
      } else {
        video.onloadedmetadata = () => play()
      }
    }
  }, [activeCameraSlot, cameraStream])

  useEffect(() => () => stopCamera(), [stopCamera])

  useEffect(() => {
    if (currentStep !== 'photos') {
      stopCamera()
    }
  }, [currentStep, stopCamera])

  const convertFileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const savePhoto = (slot: number, base64: string) => {
    const timestamp = new Date().toISOString()
    setPhotos((prev) => {
      const filtered = prev.filter((photo) => photo.slot !== slot)
      return [...filtered, { slot, photo: base64, timestamp, id: `ops-${slot}-${Date.now()}` }]
    })
    setError(null)
  }

  const removePhoto = (slot: number) => {
    setPhotos((prev) => prev.filter((photo) => photo.slot !== slot))
    setError(null)
  }

  const handlePhotoCapture = async (slot: number, file: File) => {
    try {
      const base64 = await convertFileToBase64(file)
      savePhoto(slot, base64)
    } catch (err) {
      console.error('Failed to process uploaded photo:', err)
      setError('Failed to process the photo. Please try again.')
    } finally {
      stopCamera()
    }
  }

  const startCamera = async (slot: number) => {
    try {
      stopCamera()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      setActiveCameraSlot(slot)
      setCameraStream(stream)
      setError(null)
    } catch (err) {
      console.error('Camera start failed:', err)
      setError('Unable to access the camera. Please grant permission and try again.')
      stopCamera()
    }
  }

  const captureFromCamera = async () => {
    if (activeCameraSlot === null || !videoRef.current) return
    try {
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      const width = video.videoWidth || 1280
      const height = video.videoHeight || 720
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas context unavailable')
      }
      ctx.drawImage(video, 0, 0, width, height)
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve as BlobCallback, 'image/jpeg', 0.92),
      )
      if (!blob) {
        throw new Error('Failed to capture photo')
      }
      const file = new File([blob], `ops-photo-${activeCameraSlot}.jpg`, { type: 'image/jpeg' })
      await handlePhotoCapture(activeCameraSlot, file)
    } catch (err) {
      console.error('Capture failed:', err)
      setError('Failed to capture the photo. Please try again.')
    }
  }

  const handleFileUpload = (slot: number) => {
    setPendingUploadSlot(slot)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const slot = pendingUploadSlot
    setPendingUploadSlot(null)
    const file = event.target.files?.[0]
    if (!slot || !file) {
      return
    }
    await handlePhotoCapture(slot, file)
  }

  const handleSubmit = async () => {
    if (!hasAllPhotos) {
      setError('Please capture all three inspection photos before finishing.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const payloadPhotos: OpsInspectionPhoto[] = photosSorted.map(({ slot, photo, timestamp }) => ({
        slot,
        photo,
        timestamp,
      }))

      const success = await QRService.saveOpsInspection({
        cleanerId,
        photos: payloadPhotos,
        siteName,
        customerName,
        clockInTime,
        qrCodeId,
      })

      if (!success) {
        setError('Unable to submit the inspection right now. Please try again.')
        return
      }

      setSubmittedAt(new Date().toISOString())
      setCurrentStep('next_action')
    } catch (err) {
      console.error('Ops inspection submission failed:', err)
      setError('Something went wrong while submitting the inspection.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setPhotos([])
    setSubmittedAt(null)
    setCurrentStep('photos')
    setError(null)
  }

  const handleClockOutSuccess = () => {
    onClockOut?.()
  }

  const formattedClockIn = clockInTime
    ? new Date(clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const formattedDate = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const renderPhotoSlot = (slot: number) => {
    const captured = photosSorted.find((photo) => photo.slot === slot)
    const isActive = activeCameraSlot === slot

    return (
      <div key={slot} className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge className="px-3 py-1 text-xs font-semibold" style={{ backgroundColor: '#00339B' }}>
            Photo {slot}
          </Badge>
          {captured && (
            <span className="text-[11px] text-slate-500">
              Captured {new Date(captured.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div
          className="relative rounded-3xl border-2 border-dashed border-blue-200 bg-blue-50/60 overflow-hidden"
          style={{ aspectRatio: '4 / 3' }}
        >
          {isActive ? (
            <div className="relative h-full w-full">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
              <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={stopCamera}
                  className="h-12 w-12 rounded-full border border-white/40 bg-white/90 text-[#00339B] shadow"
                  aria-label="Cancel"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  onClick={captureFromCamera}
                  className="h-14 w-14 rounded-full bg-white text-[#00339B] shadow"
                  aria-label="Capture photo"
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </div>
            </div>
          ) : captured ? (
            <div className="h-full w-full">
              <img src={captured.photo} alt={`Inspection ${slot}`} className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-end justify-between p-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removePhoto(slot)}
                  className="h-11 w-11 rounded-full border border-white/40 bg-white/90 text-[#00339B] shadow"
                  aria-label="Remove photo"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startCamera(slot)}
                  className="h-11 w-11 rounded-full border border-white/40 bg-white/90 text-[#00339B] shadow"
                  aria-label="Retake photo"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[#00339B]">
              <div className="flex gap-3">
                <Button
                  onClick={() => startCamera(slot)}
                  className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold shadow"
                >
                  <Camera className="h-4 w-4" />
                  Take photo
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleFileUpload(slot)}
                  className="flex items-center gap-2 rounded-full border-[#00339B]/20 bg-white/80 px-5 py-2 text-sm font-semibold text-[#00339B] shadow"
                >
                  <Folder className="h-4 w-4" />
                  Upload
                </Button>
              </div>
              <p className="text-xs text-slate-500">Capture a clear view of the inspection point.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (currentStep === 'welcome') {
    return (
      <div className="w-full max-w-lg mx-auto space-y-6 px-4 sm:px-0">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 sm:w-20 sm:h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-7 h-7 sm:w-10 sm:h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Welcome back, {cleanerName}!</h1>
            <p className="text-sm sm:text-lg text-gray-600">You're clocked in and ready to inspect this site.</p>
          </div>
        </div>

        <Card className="rounded-3xl border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-9 h-9 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Clock className="w-4 h-4 sm:w-6 sm:h-6" style={{ color: '#00339B' }} />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">Clocked in at</p>
                <p className="text-base sm:text-xl font-bold" style={{ color: '#00339B' }}>
                  {formattedClockIn}
                </p>
              </div>
            </div>

            {siteName && (
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-9 h-9 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-4 h-4 sm:w-6 sm:h-6" style={{ color: '#00339B' }} />
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-medium text-gray-500">Site</p>
                  <p className="text-sm sm:text-lg font-semibold" style={{ color: '#00339B' }}>{siteName}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-9 h-9 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-4 h-4 sm:w-6 sm:h-6" style={{ color: '#00339B' }} />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">Date</p>
                <p className="text-sm sm:text-lg font-semibold" style={{ color: '#00339B' }}>{formattedDate}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-0 shadow-lg">
          <CardHeader className="text-center space-y-2">
            <CardTitle className="text-lg">Inspection Checklist</CardTitle>
            <p className="text-sm text-gray-600">Capture three site photos to complete your inspection.</p>
          </CardHeader>
          <CardContent className="p-6">
            <Button
              onClick={() => setCurrentStep('photos')}
              className="w-full rounded-full py-4 text-lg font-semibold text-white shadow-lg transition-all duration-200"
              style={{ backgroundColor: '#00339B' }}
            >
              Start Site Inspection
            </Button>
            <p className="mt-3 text-xs text-center text-gray-500">
              You can clock out at any time once your inspection photos are submitted.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (currentStep === 'photos') {
    return (
      <div className="w-full max-w-3xl mx-auto space-y-6 px-4 sm:px-0">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
            <Camera className="w-8 h-8" style={{ color: '#00339B' }} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">Capture Inspection Photos</h1>
            <p className="text-gray-600">Take three photos that best represent the site condition right now.</p>
          </div>
        </div>

        <Card className="rounded-3xl border-0 shadow-lg bg-white/90">
          <CardContent className="p-6 space-y-6">
            <div className="grid gap-5">
              {Array.from({ length: REQUIRED_PHOTO_COUNT }, (_, index) => renderPhotoSlot(index + 1))}
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-600">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                onClick={handleSubmit}
                disabled={!hasAllPhotos || isSubmitting}
                className="flex-1 rounded-full py-3 text-white"
                style={{ backgroundColor: '#00339B' }}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Submitting…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Submit Inspection
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentStep('clock_out')}
                className="flex-1 rounded-full border-red-200 text-red-600 hover:bg-red-50"
              >
                <Clock className="h-4 w-4 mr-2" />
                Clock Out
              </Button>
            </div>
            <p className="text-xs text-center text-gray-500">All three photos are required to complete the inspection.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (currentStep === 'next_action') {
    return (
      <div className="w-full max-w-lg mx-auto space-y-6 px-4 sm:px-0">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <Check className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold" style={{ color: '#00339B' }}>Inspection Submitted</h1>
            <p className="text-gray-600">Great work! Your site photos are stored safely.</p>
          </div>
        </div>

        <Card className="rounded-3xl border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-6 space-y-4">
            {siteName && (
              <div className="flex items-center justify-between text-sm text-[#00339B]">
                <span className="font-medium">Site</span>
                <span>{siteName}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm text-[#00339B]">
              <span className="font-medium">Photos captured</span>
              <span>{photosSorted.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-[#00339B]">
              <span className="font-medium">Submitted at</span>
              <span>{submittedAt ? new Date(submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-center text-lg">Next Steps</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <Button
              onClick={() => setCurrentStep('clock_out')}
              className="w-full rounded-full py-4 text-lg font-semibold text-white shadow-lg"
              style={{ backgroundColor: '#00339B' }}
            >
              <Clock className="w-5 h-5 mr-3" />
              Finish & Clock Out
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              className="w-full rounded-full py-4 text-lg font-semibold text-[#00339B] border-[#00339B]/30"
            >
              <RotateCcw className="w-5 h-5 mr-3" />
              Retake Photos
            </Button>
            <Button
              variant="ghost"
              onClick={() => setCurrentStep('photos')}
              className="w-full rounded-full py-3 text-sm text-gray-500"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Inspection
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (currentStep === 'clock_out') {
    return (
      <div className="w-full space-y-4">
        <ClockOutValidator
          cleanerId={cleanerId}
          cleanerName={cleanerName}
          onClockOutSuccess={handleClockOutSuccess}
          onCancel={() => setCurrentStep(submittedAt ? 'next_action' : 'photos')}
        />
      </div>
    )
  }

  return null
}

export default OpsWorkflowManager

