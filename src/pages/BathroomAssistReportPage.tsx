import React, { useState, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { supabase } from '@/services/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CheckCircle2, Loader2, AlertCircle, UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const issueOptions = [
  { key: 'toilet_blocked', label: 'Toilet blocked' },
  { key: 'floor_wet', label: 'Floor is wet' },
  { key: 'supplies_low', label: 'Low supplies (paper, soap, etc.)' },
  { key: 'bad_smell', label: 'Odour issue' },
  { key: 'maintenance', label: 'Maintenance issue (door, lights, etc.)' },
  { key: 'other', label: 'Something else' }
] as const

type IssueKey = (typeof issueOptions)[number]['key']

const formSchema = z.object({
  bathroomLabel: z.string().min(1),
  customer: z.string().min(1, 'Missing customer name'),
  issueType: z.string().min(1, 'Please select an issue'),
  description: z.string().max(600).optional(),
  reporterName: z.string().optional(),
  contactInfo: z.string().optional()
})

interface UploadPreview {
  id: string
  name: string
  size: number
  dataUrl: string
  uploading: boolean
  error?: string
}

const MAX_FILES = 3
const ACCEPTED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const parseQuery = (params: URLSearchParams) => {
  const customer = params.get('customer') || params.get('c') || ''
  const bathroom = params.get('bathroom') || params.get('label') || params.get('area') || ''
  const qrCodeId = params.get('qr') || params.get('qr_code') || params.get('id') || ''
  const issue = params.get('issue') as IssueKey | null

  return {
    customer,
    bathroomLabel: bathroom,
    qrCodeId,
    presetIssue: issue && issueOptions.find(option => option.key === issue) ? issue : null
  }
}

const humanize = (value: string) => value.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })

const uploadToStorage = async (bucketPath: string, fileName: string, file: File) => {
  const { data, error } = await supabase.storage
    .from('bathroom-assist')
    .upload(`${bucketPath}/${fileName}`, file, { upsert: false })

  if (error) throw error
  const { data: publicUrlData } = supabase.storage.from('bathroom-assist').getPublicUrl(`${bucketPath}/${fileName}`)
  return publicUrlData.publicUrl
}

const BathroomAssistReportPage: React.FC = () => {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { customer, bathroomLabel, qrCodeId, presetIssue } = useMemo(() => parseQuery(params), [params])

  const [issueType, setIssueType] = useState<IssueKey | ''>(presetIssue || '')
  const [description, setDescription] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [contactInfo, setContactInfo] = useState('')
  const [files, setFiles] = useState<UploadPreview[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || !fileList.length) return

    const existingCount = files.length
    const availableSlots = MAX_FILES - existingCount
    const nextFiles = Array.from(fileList).slice(0, availableSlots)

    const previews: UploadPreview[] = []
    for (const file of nextFiles) {
      if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
        toast({
          title: 'Unsupported file type',
          description: 'Please upload JPG, PNG, or WebP images.',
          variant: 'destructive'
        })
        continue
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: 'Maximum file size is 5MB per photo.',
          variant: 'destructive'
        })
        continue
      }

      previews.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        dataUrl: await fileToDataUrl(file),
        uploading: false
      })
    }

    setFiles(prev => [...prev, ...previews])
    event.target.value = ''
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(file => file.id !== id))
  }

  const resetForm = () => {
    setIssueType('')
    setDescription('')
    setReporterName('')
    setContactInfo('')
    setFiles([])
    setError(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const result = formSchema.safeParse({
      bathroomLabel: bathroomLabel || '',
      customer,
      issueType,
      description: description.trim() || undefined,
      reporterName: reporterName.trim() || undefined,
      contactInfo: contactInfo.trim() || undefined
    })

    if (!result.success) {
      const firstError = result.error.errors[0]?.message || 'Please fill in the required fields.'
      setError(firstError)
      return
    }

    setSubmitting(true)

    try {
      const bucketPath = `requests/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`
      const uploadedMedia: { type: 'before' | 'after'; url: string; name: string; size: number }[] = []

      for (const preview of files) {
        const fileName = `${crypto.randomUUID()}-${preview.name.replace(/[^a-zA-Z0-9.]+/g, '-')}`
        const blob = await (await fetch(preview.dataUrl)).blob()
        const file = new File([blob], fileName, { type: blob.type })
        uploadedMedia.push({
          type: 'before',
          url: await uploadToStorage(bucketPath, fileName, file),
          name: preview.name,
          size: preview.size
        })
      }

      const { data, error: insertError } = await supabase
        .from('bathroom_assist_requests')
        .insert({
          qr_code_id: qrCodeId || null,
          customer_name: customer,
          location_label: bathroomLabel || 'Bathroom',
          issue_type: issueType,
          issue_description: description.trim() || null,
          reported_by: reporterName.trim() || null,
          reported_contact: contactInfo.trim() || null,
          before_media: uploadedMedia,
          metadata: {
            source: 'public_form',
            query: Object.fromEntries(params.entries()),
            browser: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
          },
          escalate_after: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        })
        .select('id')
        .single()

      if (insertError) throw insertError

      await supabase.from('bathroom_assist_events').insert({
        request_id: data.id,
        event_type: 'reported',
        actor_role: 'staff',
        actor_name: reporterName || 'Anonymous',
        payload: {
          issue: issueType,
          description: description.trim() || null,
          attachments: uploadedMedia.map(file => ({ url: file.url, name: file.name }))
        }
      })

      setSubmittedRequestId(data.id)
      toast({
        title: 'Request sent',
        description: 'Thanks! The cleaning team has been notified.'
      })
      resetForm()
    } catch (submitError) {
      console.error(submitError)
      const message = submitError instanceof Error ? submitError.message : 'Failed to submit request. Please try again.'
      setError(message)
      toast({
        title: 'Submission failed',
        description: message,
        variant: 'destructive'
      })
    } finally {
      setSubmitting(false)
    }
  }

  const startNewRequest = () => {
    setSubmittedRequestId(null)
    resetForm()
  }

  if (!customer || !bathroomLabel) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full border-0 shadow-2xl rounded-3xl">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl font-semibold text-red-600 flex items-center justify-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Missing QR details
            </CardTitle>
            <p className="text-gray-600">
              This QR code is missing some setup information. Please contact support or scan a different code.
            </p>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (submittedRequestId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full border-0 shadow-2xl rounded-3xl">
          <CardHeader className="text-center space-y-3">
            <CardTitle className="text-3xl font-bold text-[#00339B] flex items-center justify-center gap-3">
              <CheckCircle2 className="h-8 w-8" />
              Request submitted
            </CardTitle>
            <p className="text-gray-600">
              Thank you! Our cleaning team has been notified about the issue in {humanize(bathroomLabel)}.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-sm text-blue-900">Request reference</p>
                <p className="font-semibold text-blue-700 text-sm break-all">{submittedRequestId}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-blue-100 text-blue-700 rounded-full">{humanize(customer)}</Badge>
                <Badge className="bg-green-100 text-green-700 rounded-full">{humanize(bathroomLabel)}</Badge>
              </div>
            </div>
            <Button className="w-full rounded-full" onClick={startNewRequest}>
              Submit another issue
            </Button>
            <Button variant="ghost" className="w-full rounded-full" onClick={() => navigate('/')}
            >
              Done
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-0 shadow-2xl rounded-3xl">
        <CardHeader className="space-y-3 text-center">
          <div className="flex items-center justify-center">
            <Badge className="bg-blue-100 text-blue-700 rounded-full px-4 py-2 text-sm">Bathroom Assist</Badge>
          </div>
          <CardTitle className="text-3xl font-bold text-[#00339B]">
            Need help in {humanize(bathroomLabel)}?
          </CardTitle>
          <p className="text-gray-600">
            Tell us what’s wrong and our cleaning team will sort it right away.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 rounded-2xl p-4 flex flex-wrap gap-3 justify-between items-center">
            <div>
              <p className="text-xs uppercase tracking-wide text-blue-700">Location</p>
              <p className="text-lg font-semibold text-blue-900">{humanize(bathroomLabel)}</p>
            </div>
            <Badge className="bg-white text-blue-700 border border-blue-200 rounded-full px-4 py-1 text-sm">
              {humanize(customer)}
            </Badge>
          </div>

          {error ? (
            <Alert variant="destructive" className="rounded-2xl">
              <AlertTitle>Something’s missing</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <section className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">What’s the issue?</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {issueOptions.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setIssueType(option.key)}
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-left transition-all',
                      issueType === option.key
                        ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-lg'
                        : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50'
                    )}
                  >
                    <span className="font-medium">{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            {issueType === 'other' ? (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Describe the issue</Label>
                <Textarea
                  placeholder="Give us a few details so we know what to fix."
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  rows={4}
                  className="rounded-2xl"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Anything else we should know? (optional)</Label>
                <Textarea
                  placeholder="Add extra information if you want."
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  rows={3}
                  className="rounded-2xl"
                />
              </div>
            )}

            <section className="space-y-3">
              <Label className="text-sm font-semibold text-gray-700">Add photos (optional)</Label>
              <label
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-6 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition"
              >
                <UploadCloud className="h-8 w-8 text-blue-500" />
                <span className="text-sm text-blue-700">
                  Tap to upload up to {MAX_FILES} photos
                </span>
                <Input
                  type="file"
                  accept={ACCEPTED_FILE_TYPES.join(',')}
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {files.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {files.map(file => (
                    <div key={file.id} className="relative">
                      <img src={file.dataUrl} alt={file.name} className="rounded-2xl border object-cover h-32 w-full" />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-7 w-7 rounded-full"
                        onClick={() => removeFile(file.id)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Your name (optional)</Label>
                <Input
                  placeholder="You can stay anonymous"
                  value={reporterName}
                  onChange={event => setReporterName(event.target.value)}
                  className="rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Contact info (optional)</Label>
                <Input
                  placeholder="Phone or email"
                  value={contactInfo}
                  onChange={event => setContactInfo(event.target.value)}
                  className="rounded-2xl"
                />
              </div>
            </section>

            <Button
              type="submit"
              disabled={!issueType || submitting}
              className="w-full rounded-full py-5 text-lg font-semibold"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Sending request...
                </span>
              ) : (
                'Send to cleaning team'
              )}
            </Button>
          </form>

          <p className="text-xs text-gray-400 text-center">
            Powered by Suburban Services • Your request is sent securely to the cleaning ops team.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default BathroomAssistReportPage
