import React, { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { DateTimeField } from '@/components/schedule/DateTimeField'
import type { CleanerShift } from '@/services/shiftsService'

export interface ShiftDialogCleanerOption {
  id: string
  name: string
}

export interface ShiftDialogCustomerOption {
  id: string
  name: string
}

export interface ShiftDialogValue {
  cleanerId: string
  customerId: string | null
  siteName: string | null
  startAt: Date
  endAt: Date
  notes: string | null
}

interface ShiftDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initialDay?: Date
  initialHour?: number
  shift?: CleanerShift | null
  cleaners: ShiftDialogCleanerOption[]
  customers: ShiftDialogCustomerOption[]
  isSubmitting?: boolean
  onSubmit: (value: ShiftDialogValue) => Promise<void> | void
  onDelete?: (shiftId: string) => Promise<void> | void
  onOpenChange: (open: boolean) => void
}

const buildInitialStart = (day?: Date, hour?: number): Date => {
  const base = day ? new Date(day) : new Date()
  base.setHours(hour ?? 9, 0, 0, 0)
  return base
}

const fieldClass =
  'h-11 rounded-xl border-0 bg-gray-100/80 px-3.5 text-[14px] text-gray-900 placeholder:text-gray-400 shadow-none ring-0 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#007AFF]/30'

export const ShiftDialog: React.FC<ShiftDialogProps> = ({
  open,
  mode,
  initialDay,
  initialHour,
  shift,
  cleaners,
  customers,
  isSubmitting = false,
  onSubmit,
  onDelete,
  onOpenChange,
}) => {
  const [cleanerId, setCleanerId] = useState<string>('')
  const [customerId, setCustomerId] = useState<string>('')
  const [siteName, setSiteName] = useState<string>('')
  const [startAt, setStartAt] = useState<Date | null>(null)
  const [endAt, setEndAt] = useState<Date | null>(null)
  const [notes, setNotes] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setError(null)
      return
    }

    if (mode === 'edit' && shift) {
      setCleanerId(shift.cleanerId)
      setCustomerId(shift.customerId ?? '')
      setSiteName(shift.siteName ?? '')
      setStartAt(new Date(shift.startAt))
      setEndAt(new Date(shift.endAt))
      setNotes(shift.notes ?? '')
    } else {
      const start = buildInitialStart(initialDay, initialHour)
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      setCleanerId('')
      setCustomerId('')
      setSiteName('')
      setStartAt(start)
      setEndAt(end)
      setNotes('')
    }
    setError(null)
  }, [open, mode, shift, initialDay, initialHour])

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>()
    customers.forEach((c) => map.set(c.id, c.name))
    return map
  }, [customers])

  const handleSubmit = async () => {
    setError(null)

    if (!cleanerId) {
      setError('Pick a cleaner')
      return
    }
    if (!startAt || !endAt) {
      setError('Pick start and end times')
      return
    }
    if (endAt.getTime() <= startAt.getTime()) {
      setError('End must be after start')
      return
    }

    const resolvedSiteName =
      siteName.trim() || (customerId ? customerNameById.get(customerId) ?? null : null)

    await onSubmit({
      cleanerId,
      customerId: customerId || null,
      siteName: resolvedSiteName,
      startAt,
      endAt,
      notes: notes.trim() || null,
    })
  }

  const handleDelete = async () => {
    if (!shift) return
    if (!window.confirm('Delete this shift?')) return
    await onDelete?.(shift.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] rounded-3xl border-0 bg-white p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.25)]">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-[22px] font-semibold tracking-tight text-gray-900">
            {mode === 'edit' ? 'Edit shift' : 'New shift'}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-gray-500">
            {mode === 'edit' && shift
              ? `Created ${format(new Date(shift.createdAt), 'PP')}`
              : 'Assign a cleaner to a time and place.'}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="shift-cleaner" className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
              Cleaner
            </Label>
            <Select value={cleanerId} onValueChange={setCleanerId}>
              <SelectTrigger id="shift-cleaner" className={fieldClass}>
                <SelectValue placeholder="Pick a cleaner" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border border-gray-100 bg-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                {cleaners.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shift-customer" className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
              Customer
            </Label>
            <Select value={customerId || 'none'} onValueChange={(v) => setCustomerId(v === 'none' ? '' : v)}>
              <SelectTrigger id="shift-customer" className={fieldClass}>
                <SelectValue placeholder="Pick a customer" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border border-gray-100 bg-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
                <SelectItem value="none">No customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shift-site" className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
              Site
            </Label>
            <Input
              id="shift-site"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="Defaults to customer name"
              className={fieldClass}
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="shift-start" className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
                Start
              </Label>
              <DateTimeField id="shift-start" value={startAt} onChange={setStartAt} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shift-end" className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
                End
              </Label>
              <DateTimeField id="shift-end" value={endAt} onChange={setEndAt} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shift-notes" className="text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
              Notes
            </Label>
            <Textarea
              id="shift-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              rows={3}
              className="resize-none rounded-xl border-0 bg-gray-100/80 px-3.5 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 shadow-none focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#007AFF]/30"
            />
          </div>

          {error ? (
            <p className="text-[13px] font-medium text-red-500">{error}</p>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div>
            {mode === 'edit' && shift && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={isSubmitting}
                className="h-10 rounded-full px-4 text-[13px] font-medium text-red-500 hover:bg-red-50 hover:text-red-600"
              >
                Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-10 rounded-full px-4 text-[13px] font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="h-10 rounded-full bg-[#007AFF] px-5 text-[13px] font-semibold text-white shadow-none hover:bg-[#0064D2]"
            >
              {mode === 'edit' ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
