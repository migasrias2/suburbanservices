import React, { useEffect, useMemo, useState } from 'react'
import { supabase, BathroomAssistRequest } from '@/services/supabase'
import { AssistRequestService, AssistMedia } from '@/services/assistRequestService'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { Loader2, Clock, MapPin, Camera, CheckCircle2, AlertCircle, UploadCloud, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

interface BathroomAssistPanelProps {
  cleanerId: string
  cleanerName: string
}

interface LocalMedia extends AssistMedia {
  id: string
  preview: string
  uploading?: boolean
  error?: string
}

const statusColors: Record<BathroomAssistRequest['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-blue-100 text-blue-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  escalated: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700'
}

const storageBucket = 'bathroom-assist'
const MAX_MEDIA = 4
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const dataUrlFromFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })

const BathroomAssistPanel: React.FC<BathroomAssistPanelProps> = ({ cleanerId, cleanerName }) => {
  const [requests, setRequests] = useState<BathroomAssistRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState<BathroomAssistRequest | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [materials, setMaterials] = useState('')
  const [afterPhotos, setAfterPhotos] = useState<LocalMedia[]>([])
  const [resolving, setResolving] = useState(false)

  const customerName = useMemo(() => requests[0]?.customer_name || '', [requests])

  const loadRequests = async () => {
    setLoading(true)
    try {
      const data = await AssistRequestService.listPendingForCleaner(cleanerId)
      setRequests(data)
    } catch (error) {
      console.error(error)
      toast({ title: 'Could not load requests', description: 'Please try again later.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()

    const channel = supabase
      .channel('bathroom-assist-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bathroom_assist_requests' }, () => {
        loadRequests()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [cleanerId])

  const openDetail = (request: BathroomAssistRequest) => {
    setSelectedRequest(request)
    setNotes('')
    setMaterials('')
    setAfterPhotos([])
    setDetailOpen(true)
  }

  const closeDetail = () => {
    setDetailOpen(false)
    setSelectedRequest(null)
    setResolving(false)
    setNotes('')
    setMaterials('')
    setAfterPhotos([])
  }

  const handleAccept = async (request: BathroomAssistRequest) => {
    try {
      await AssistRequestService.accept({ requestId: request.id, cleanerId, cleanerName })
      toast({ title: 'Request accepted', description: `Heading to ${request.location_label}.` })
      loadRequests()
    } catch (error) {
      console.error(error)
      toast({ title: 'Could not accept request', description: 'Please try again.', variant: 'destructive' })
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList) return

    const files = Array.from(fileList)
    const slots = MAX_MEDIA - afterPhotos.length
    const selected = files.slice(0, slots)

    const previews: LocalMedia[] = []

    for (const file of selected) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast({ title: 'Unsupported file', description: 'Upload JPG, PNG, or WebP images.', variant: 'destructive' })
        continue
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({ title: 'File too large', description: 'Max size is 5MB per photo.', variant: 'destructive' })
        continue
      }

      previews.push({
        id: crypto.randomUUID(),
        type: 'after',
        name: file.name,
        size: file.size,
        preview: await dataUrlFromFile(file),
        url: '',
        uploading: true
      })
    }

    if (previews.length === 0) return

    setAfterPhotos(prev => [...prev, ...previews])

    const bucketPath = `after/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`

    for (const media of previews) {
      try {
        const response = await fetch(media.preview)
        const blob = await response.blob()
        const fileName = `${crypto.randomUUID()}-${media.name?.replace(/[^a-zA-Z0-9.]+/g, '-') || 'photo'}`
        const { data, error } = await supabase.storage.from(storageBucket).upload(`${bucketPath}/${fileName}`, blob, {
          contentType: blob.type
        })
        if (error) throw error
        const { data: publicUrlData } = supabase.storage.from(storageBucket).getPublicUrl(data.path)
        setAfterPhotos(prev => prev.map(item => (item.id === media.id ? { ...item, url: publicUrlData.publicUrl, uploading: false } : item)))
      } catch (uploadError) {
        console.error(uploadError)
        setAfterPhotos(prev => prev.map(item => (item.id === media.id ? { ...item, error: 'Failed to upload', uploading: false } : item)))
        toast({ title: 'Upload failed', description: 'Could not upload one of the photos.', variant: 'destructive' })
      }
    }
  }

  const removeAfterPhoto = (id: string) => {
    setAfterPhotos(prev => prev.filter(photo => photo.id !== id))
  }

  const handleResolve = async () => {
    if (!selectedRequest) return

    setResolving(true)
    try {
      const media = afterPhotos.filter(photo => photo.url && !photo.error).map(photo => ({
        type: 'after' as const,
        url: photo.url,
        name: photo.name,
        size: photo.size
      }))

      await AssistRequestService.resolve({
        requestId: selectedRequest.id,
        cleanerId,
        cleanerName,
        notes: notes.trim() || undefined,
        materialsUsed: materials.trim() || undefined,
        afterMedia: media
      })

      toast({ title: 'Request resolved', description: `${selectedRequest.location_label} marked complete.` })
      closeDetail()
      loadRequests()
    } catch (error) {
      console.error(error)
      toast({ title: 'Could not resolve request', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setResolving(false)
    }
  }

  const pending = requests.filter(request => request.status === 'pending')
  const accepted = requests.filter(request => request.status === 'accepted')

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-xl rounded-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl font-semibold text-[#00339B]">
            <Camera className="h-6 w-6" />
            Bathroom Assist Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : requests.length === 0 ? (
            <Alert className="border-blue-200 bg-blue-50 rounded-2xl">
              <AlertCircle className="h-5 w-5 text-blue-600" />
              <AlertDescription className="text-blue-800">
                No requests right now. You’ll see new issues here instantly when they come in.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Badge variant="outline" className="rounded-full px-3 py-1 bg-amber-50 text-amber-700 border-amber-200">
                    Pending ({pending.length})
                  </Badge>
                </h3>
                <ScrollArea className="h-[420px] pr-2">
                  <div className="space-y-4">
                    {pending.map(request => (
                      <button
                        key={request.id}
                        className="w-full text-left rounded-2xl border border-amber-100 bg-amber-50/60 hover:bg-amber-100 transition p-4 flex flex-col gap-3"
                        onClick={() => openDetail(request)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={cn('rounded-full', statusColors[request.status])}>{request.status}</Badge>
                            <span className="text-sm text-gray-500">{new Date(request.reported_at).toLocaleTimeString()}</span>
                          </div>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={(event) => { event.stopPropagation(); handleAccept(request) }}>
                            Accept
                          </Button>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{request.location_label}</p>
                          <p className="text-sm text-gray-600">{request.issue_type.replace(/_/g, ' ')}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Badge variant="outline" className="rounded-full px-3 py-1 bg-blue-50 text-blue-700 border-blue-200">
                    Accepted ({accepted.length})
                  </Badge>
                </h3>
                <ScrollArea className="h-[420px] pr-2">
                  <div className="space-y-4">
                    {accepted.map(request => (
                      <button
                        key={request.id}
                        className="w-full text-left rounded-2xl border border-blue-100 bg-blue-50 hover:bg-blue-100 transition p-4 flex flex-col gap-3"
                        onClick={() => openDetail(request)}
                      >
                        <div className="flex items-center justify-between">
                          <Badge className={cn('rounded-full', statusColors[request.status])}>In progress</Badge>
                          <span className="text-sm text-gray-500">Accepted {request.accepted_at ? new Date(request.accepted_at).toLocaleTimeString() : ''}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{request.location_label}</p>
                          <p className="text-sm text-gray-600">{request.issue_type.replace(/_/g, ' ')}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl rounded-3xl">
          {selectedRequest ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-3">
                <DialogTitle className="text-2xl font-bold text-[#00339B] flex items-center gap-3">
                  <Camera className="h-6 w-6" />
                  {selectedRequest.location_label}
                </DialogTitle>
                <DialogDescription className="text-gray-600">
                  Issue reported {new Date(selectedRequest.reported_at).toLocaleString()} · {selectedRequest.issue_type.replace(/_/g, ' ')}
                </DialogDescription>
              </DialogHeader>

              <Card className="border border-gray-100 rounded-3xl bg-gray-50/60">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <Badge className={cn('rounded-full', statusColors[selectedRequest.status])}>{selectedRequest.status}</Badge>
                    <Badge className="rounded-full bg-blue-100 text-blue-700 flex items-center gap-1">
                      <Clock className="h-4 w-4" /> {selectedRequest.accepted_at ? `Accepted ${new Date(selectedRequest.accepted_at).toLocaleTimeString()}` : 'Waiting acceptance'}
                    </Badge>
                    <Badge className="rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                      <MapPin className="h-4 w-4" /> {selectedRequest.customer_name}
                    </Badge>
                  </div>
                  {selectedRequest.issue_description ? (
                    <p className="text-sm text-gray-700">{selectedRequest.issue_description}</p>
                  ) : null}
                  {selectedRequest.before_media && Array.isArray(selectedRequest.before_media) && selectedRequest.before_media.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Camera className="h-4 w-4" /> Before photos
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        {selectedRequest.before_media.map((media: any, index: number) => (
                          <a key={index} href={media.url || media} target="_blank" rel="noreferrer">
                            <img src={media.url || media} alt="Before" className="rounded-2xl border object-cover h-32 w-full" />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Separator />

              <section className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-gray-700">Materials used (optional)</Label>
                    <Input value={materials} onChange={event => setMaterials(event.target.value)} placeholder="e.g. replaced toilet paper" className="rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-gray-700">Notes for customer (optional)</Label>
                    <Textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="rounded-2xl" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700">After photos</Label>
                  <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-green-200 bg-green-50/60 p-6 cursor-pointer hover:border-green-300 hover:bg-green-50 transition">
                    <UploadCloud className="h-8 w-8 text-green-600" />
                    <span className="text-sm text-green-700">Tap to upload proof photos</span>
                    <Input type="file" multiple accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={handleFileSelect} />
                  </label>
                  {afterPhotos.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {afterPhotos.map(photo => (
                        <div key={photo.id} className="relative">
                          <img src={photo.preview} alt={photo.name} className="rounded-2xl border object-cover h-32 w-full" />
                          <Button type="button" size="icon" variant="destructive" className="absolute -top-2 -right-2 h-7 w-7 rounded-full" onClick={() => removeAfterPhoto(photo.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {photo.uploading ? (
                            <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-2xl">
                              <Loader2 className="h-6 w-6 animate-spin text-green-600" />
                            </div>
                          ) : null}
                          {photo.error ? (
                            <div className="absolute inset-x-0 bottom-0 bg-red-600 text-white text-xs text-center py-1 rounded-b-2xl">
                              Upload failed
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              <Button onClick={handleResolve} disabled={resolving || afterPhotos.some(photo => photo.uploading)} className="w-full rounded-full py-4 text-lg font-semibold">
                {resolving ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    Mark as Resolved
                  </span>
                )}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { BathroomAssistPanel }
