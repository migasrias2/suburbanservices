import React, { useEffect, useState } from 'react'
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
import { toast } from '@/hooks/use-toast'
import { Loader2, CheckCircle2, AlertCircle, UploadCloud, Trash2 } from 'lucide-react'
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

const statusStyles: Record<BathroomAssistRequest['status'], string> = {
  pending: 'bg-warning/10 text-warning border border-warning/30',
  accepted: 'bg-primary/10 text-primary border border-border',
  resolved: 'bg-success/10 text-success border border-success/30',
  escalated: 'bg-destructive/10 text-destructive border border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border border-border'
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

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const humanStatus: Record<BathroomAssistRequest['status'], string> = {
  pending: 'Pending',
  accepted: 'In progress',
  resolved: 'Resolved',
  escalated: 'Escalated',
  cancelled: 'Cancelled'
}

const BathroomAssistPanel: React.FC<BathroomAssistPanelProps> = ({ cleanerId, cleanerName }) => {
  const [requests, setRequests] = useState<BathroomAssistRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState<BathroomAssistRequest | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [afterPhotos, setAfterPhotos] = useState<LocalMedia[]>([])
  const [beforePhotos, setBeforePhotos] = useState<LocalMedia[]>([])
  const [resolving, setResolving] = useState(false)
  const [history, setHistory] = useState<BathroomAssistRequest[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

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

    // Realtime is the fast path, but cleaners are on site wifi where websockets are
    // often blocked. Poll as a fallback so a request can never sit unseen.
    const interval = setInterval(loadRequests, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [cleanerId])

  const openDetail = (request: BathroomAssistRequest) => {
    setSelectedRequest(request)
    setAfterPhotos([])
    setBeforePhotos([])
    setDetailOpen(true)
  }

  const closeDetail = () => {
    setDetailOpen(false)
    setSelectedRequest(null)
    setResolving(false)
    setAfterPhotos([])
    setBeforePhotos([])
    setHistory([])
    setHistoryError(null)
    setHistoryLoading(false)
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

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'before' | 'after'
  ) => {
    const fileList = event.target.files
    if (!fileList) return

    const files = Array.from(fileList)
    const current = target === 'before' ? beforePhotos : afterPhotos
    const setState = target === 'before' ? setBeforePhotos : setAfterPhotos
    const slots = MAX_MEDIA - current.length
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
        type: target,
        name: file.name,
        size: file.size,
        preview: await dataUrlFromFile(file),
        url: '',
        uploading: true
      })
    }

    if (previews.length === 0) return

    setState(prev => [...prev, ...previews])

    const bucketPath = `${target}/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`

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
        setState(prev => prev.map(item => (item.id === media.id ? { ...item, url: publicUrlData.publicUrl, uploading: false } : item)))
      } catch (uploadError) {
        console.error(uploadError)
        setState(prev => prev.map(item => (item.id === media.id ? { ...item, error: 'Failed to upload', uploading: false } : item)))
        toast({ title: 'Upload failed', description: 'Could not upload one of the photos.', variant: 'destructive' })
      }
    }
  }

  const removePhoto = (id: string, target: 'before' | 'after') => {
    const setState = target === 'before' ? setBeforePhotos : setAfterPhotos
    setState(prev => prev.filter(photo => photo.id !== id))
  }

  const handleResolve = async () => {
    if (!selectedRequest) return

    setResolving(true)
    try {
      const mediaAfter = afterPhotos.filter(photo => photo.url && !photo.error).map(photo => ({
        type: 'after' as const,
        url: photo.url,
        name: photo.name,
        size: photo.size
      }))

      const mediaBefore = beforePhotos.filter(photo => photo.url && !photo.error).map(photo => ({
        type: 'before' as const,
        url: photo.url,
        name: photo.name,
        size: photo.size
      }))

      await AssistRequestService.resolve({
        requestId: selectedRequest.id,
        cleanerId,
        cleanerName,
        afterMedia: mediaAfter,
        beforeMedia: mediaBefore
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

  useEffect(() => {
    if (!detailOpen || !selectedRequest) {
      return
    }

    let cancelled = false

    const loadHistory = async () => {
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        const data = await AssistRequestService.listResolved({
          customerName: selectedRequest.customer_name,
          locationLabel: selectedRequest.location_label,
          status: ['resolved'],
          limit: 3
        })

        if (!cancelled) {
          setHistory(data.filter(item => item.resolved_at))
        }
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setHistoryError('Unable to load recent cleaning history.')
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false)
        }
      }
    }

    loadHistory()

    return () => {
      cancelled = true
    }
  }, [detailOpen, selectedRequest])

  const renderRequestCard = (request: BathroomAssistRequest, type: 'pending' | 'accepted') => {
    const containerStyles = type === 'pending'
      ? 'border-warning/30 bg-card/90 shadow-sm hover:shadow-lg hover:border-warning/30'
      : 'border-border bg-card/90 shadow-sm hover:shadow-lg hover:border-border'

    return (
      // A <button> here would nest the "Accept job" <button> inside it, which is invalid
      // HTML: the click lands on the outer element and opens the detail dialog instead of
      // accepting. That is why no request has ever been accepted from this screen.
      <div
        key={request.id}
        role="button"
        tabIndex={0}
        className={cn(
          'w-full text-left rounded-3xl border transition p-5 flex flex-col gap-2 cursor-pointer',
          containerStyles
        )}
        onClick={() => openDetail(request)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openDetail(request)
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground leading-tight">{request.location_label}</p>
            <p className="text-xs text-muted-foreground capitalize">{request.issue_type.replace(/_/g, ' ')} · {formatTime(request.reported_at)}</p>
          </div>
          {type === 'pending' ? (
            <Button
              size="sm"
              className="rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-md shadow-blue-200 transition hover:bg-primary/90 hover:shadow-lg hover:-translate-y-[1px]"
              onClick={(event) => {
                event.stopPropagation()
                handleAccept(request)
              }}
            >
              Accept job
            </Button>
          ) : (
            <Badge className={cn('rounded-full px-3 py-1 text-xs font-medium', statusStyles[request.status])}>
              {humanStatus[request.status]}
            </Badge>
          )}
        </div>
        {request.issue_description ? (
          <p className="text-xs text-muted-foreground rounded-2xl bg-muted px-3 py-2">
            {request.issue_description}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-xl rounded-3xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl font-semibold text-primary">
                Bathroom Assist Requests
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Live queue of staff reports. Tap a request to view details and close it out.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : requests.length === 0 ? (
            <Alert className="border-border bg-primary/10 rounded-2xl">
              <AlertCircle className="h-5 w-5 text-primary" />
              <AlertDescription className="text-primary">
                No requests right now. You’ll see new issues here instantly when they come in.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.18em]">Pending</h3>
                  <span className="text-xs font-medium text-muted-foreground">{pending.length}</span>
                </div>
                <ScrollArea className="h-[380px] pr-2">
                  <div className="space-y-4">
                    {pending.map((request) => renderRequestCard(request, 'pending'))}
                  </div>
                </ScrollArea>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.18em]">In progress</h3>
                  <span className="text-xs font-medium text-muted-foreground">{accepted.length}</span>
                </div>
                <ScrollArea className="h-[380px] pr-2">
                  <div className="space-y-4">
                    {accepted.map((request) => renderRequestCard(request, 'accepted'))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-3xl border-0 shadow-2xl">
          {selectedRequest ? (
            <div className="space-y-5">
              <DialogHeader className="space-y-2">
                <DialogTitle className="text-xl font-semibold text-foreground">
                  {selectedRequest.location_label}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {humanStatus[selectedRequest.status]} · {selectedRequest.issue_type.replace(/_/g, ' ')} · {selectedRequest.accepted_at ? `Accepted ${formatTime(selectedRequest.accepted_at)}` : `Reported ${formatTime(selectedRequest.reported_at)}`}
                </DialogDescription>
              </DialogHeader>

              {selectedRequest.issue_description ? (
                <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                  {selectedRequest.issue_description}
                </p>
              ) : null}

              {selectedRequest.before_media && Array.isArray(selectedRequest.before_media) && selectedRequest.before_media.length > 0 ? (
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Existing photos</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedRequest.before_media.map((media: any, index: number) => (
                      <a key={index} href={media.url || media} target="_blank" rel="noreferrer">
                        <img src={media.url || media} alt="Before" className="h-28 w-full rounded-2xl border object-cover shadow-sm" />
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-foreground">Before photos (optional)</Label>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-primary/5 p-5 text-center text-sm text-primary transition hover:border-primary/30 hover:bg-primary/10 cursor-pointer">
                      <UploadCloud className="h-6 w-6" />
                      Tap to add before photos
                      <Input type="file" multiple accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={(event) => handleFileSelect(event, 'before')} />
                    </label>
                    {beforePhotos.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {beforePhotos.map(photo => (
                          <div key={photo.id} className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                            <img src={photo.preview} alt={photo.name} className="h-28 w-full object-cover" />
                            <div className="absolute top-2 left-2 rounded-full bg-primary/90 px-2 py-1 text-caption2 font-medium uppercase tracking-[0.14em] text-primary-foreground">
                              Before
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="destructive"
                              className="absolute top-2 right-2 h-7 w-7 rounded-full"
                              onClick={() => removePhoto(photo.id, 'before')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            {photo.uploading ? (
                              <div className="absolute inset-0 flex items-center justify-center bg-card/70">
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              </div>
                            ) : null}
                            {photo.error ? (
                              <div className="absolute inset-x-0 bottom-0 bg-destructive text-destructive-foreground text-xs text-center py-1">
                                Upload failed
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-foreground">After photos</Label>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-success/30 bg-success/5 p-5 text-center text-sm text-success transition hover:border-success/30 hover:bg-success/10 cursor-pointer">
                      <UploadCloud className="h-6 w-6" />
                      Tap to add proof photos
                      <Input type="file" multiple accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={(event) => handleFileSelect(event, 'after')} />
                    </label>
                    {afterPhotos.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {afterPhotos.map(photo => (
                          <div key={photo.id} className="relative overflow-hidden rounded-3xl border border-success/30 bg-card shadow-sm">
                            <img src={photo.preview} alt={photo.name} className="h-28 w-full object-cover" />
                            <div className="absolute top-2 left-2 rounded-full bg-success/90 px-2 py-1 text-caption2 font-medium uppercase tracking-[0.14em] text-success-foreground">
                              After
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="destructive"
                              className="absolute top-2 right-2 h-7 w-7 rounded-full"
                              onClick={() => removePhoto(photo.id, 'after')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            {photo.uploading ? (
                              <div className="absolute inset-0 flex items-center justify-center bg-card/70">
                                <Loader2 className="h-5 w-5 animate-spin text-success" />
                              </div>
                            ) : null}
                            {photo.error ? (
                              <div className="absolute inset-x-0 bottom-0 bg-destructive text-destructive-foreground text-xs text-center py-1">
                                Upload failed
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <Separator />

              <Button
                onClick={handleResolve}
                disabled={resolving || afterPhotos.some(photo => photo.uploading) || beforePhotos.some(photo => photo.uploading)}
                className="w-full rounded-full bg-primary py-4 text-lg font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
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

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Last cleaning checks</h4>
                {historyLoading ? (
                  <span className="text-xs text-muted-foreground">Loading…</span>
                ) : historyError ? (
                  <span className="text-xs text-destructive">{historyError}</span>
                ) : null}
              </div>
              <div className="rounded-2xl border border-destructive/30 overflow-hidden">
                <div className="bg-destructive/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-destructive">Time</div>
                {historyLoading ? (
                  <div className="px-4 py-3 text-sm text-muted-foreground border-t border-destructive/30">Fetching recent cleanings…</div>
                ) : history.length > 0 ? (
                  history.map(entry => (
                    <div key={entry.id} className="px-4 py-3 text-sm text-foreground border-t border-destructive/30">
                      {new Date(entry.resolved_at || '').toLocaleString(undefined, {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                      {entry.resolved_by_name ? ` · ${entry.resolved_by_name}` : ''}
                    </div>
                  ))
                ) : historyError ? null : (
                  <div className="px-4 py-3 text-sm text-muted-foreground border-t border-destructive/30">No recent cleanings recorded.</div>
                )}
              </div>
            </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { BathroomAssistPanel }
