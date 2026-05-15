import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, addWeeks, endOfWeek, format, startOfWeek } from 'date-fns'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getStoredCleanerName } from '@/lib/identity'
import {
  WeeklyScheduleGrid,
  type WeeklyScheduleBlock,
} from '@/components/schedule/WeeklyScheduleGrid'
import { ShiftDialog, type ShiftDialogValue } from '@/components/schedule/ShiftDialog'
import {
  createShift,
  deleteShift,
  fetchShiftsInRange,
  updateShift,
  type CleanerShift,
} from '@/services/shiftsService'
import { fetchAllCleaners, type CleanerSummary } from '@/services/managerService'
import { fetchCustomers } from '@/services/customersService'
import type { Customer } from '@/services/supabase'

const getWeekRange = (anchor: Date) => {
  const start = startOfWeek(anchor, { weekStartsOn: 1 })
  start.setHours(0, 0, 0, 0)
  const end = endOfWeek(anchor, { weekStartsOn: 1 })
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

const cleanerLabel = (c: CleanerSummary): string => {
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
  return name || c.email || c.mobile_number || c.id
}

const customerLabel = (c: Customer): string =>
  (c.display_name ?? c.name ?? c.customer_name ?? '').trim() || 'Unnamed'

const AdminWeeklySchedulePage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [userName, setUserName] = useState<string>('')
  const [adminId, setAdminId] = useState<string>('')
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date())
  const [shifts, setShifts] = useState<CleanerShift[]>([])
  const [cleaners, setCleaners] = useState<CleanerSummary[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [dialogState, setDialogState] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    day?: Date
    hour?: number
    shift?: CleanerShift | null
  }>({ open: false, mode: 'create' })

  useEffect(() => {
    const role = localStorage.getItem('userType')
    const id = localStorage.getItem('userId') ?? ''
    const name = getStoredCleanerName()
    if (role !== 'admin' || !name) {
      navigate('/login')
      return
    }
    setUserName(name)
    setAdminId(id)
  }, [navigate])

  const { start: weekStart, end: weekEnd } = useMemo(() => getWeekRange(weekAnchor), [weekAnchor])

  const loadShifts = useCallback(async () => {
    setIsLoading(true)
    try {
      const rows = await fetchShiftsInRange(weekStart, addDays(weekEnd, 1))
      setShifts(rows)
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not load shifts', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [weekStart, weekEnd, toast])

  useEffect(() => {
    if (!userName) return
    loadShifts()
  }, [userName, loadShifts])

  useEffect(() => {
    if (!userName) return
    let cancelled = false
    ;(async () => {
      try {
        const [cleanerRows, customerRows] = await Promise.all([fetchAllCleaners(), fetchCustomers()])
        if (cancelled) return
        setCleaners(cleanerRows.filter((c) => c.is_active !== false))
        setCustomers(customerRows)
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          toast({ title: 'Could not load cleaners or customers', variant: 'destructive' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userName, toast])

  const cleanerOptions = useMemo(
    () => cleaners.map((c) => ({ id: c.id, name: cleanerLabel(c) })),
    [cleaners],
  )
  const customerOptions = useMemo(
    () => customers.map((c) => ({ id: c.id, name: customerLabel(c) })),
    [customers],
  )

  const blocks = useMemo<WeeklyScheduleBlock[]>(
    () =>
      shifts.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        endAt: s.endAt,
        title: s.cleanerName ?? 'Cleaner',
        subtitle: s.siteName ?? s.customerName ?? null,
        tone: 'primary',
      })),
    [shifts],
  )

  const openCreate = (day: Date, hour: number) => {
    setDialogState({ open: true, mode: 'create', day, hour })
  }

  const openEdit = (blockId: string) => {
    const target = shifts.find((s) => s.id === blockId) ?? null
    if (!target) return
    setDialogState({ open: true, mode: 'edit', shift: target })
  }

  const closeDialog = (open: boolean) => {
    if (!open) {
      setDialogState({ open: false, mode: 'create' })
    }
  }

  const handleSubmit = async (value: ShiftDialogValue) => {
    setIsSubmitting(true)
    try {
      if (dialogState.mode === 'edit' && dialogState.shift) {
        await updateShift(dialogState.shift.id, {
          customerId: value.customerId,
          siteName: value.siteName,
          startAt: value.startAt,
          endAt: value.endAt,
          notes: value.notes,
        })
        toast({ title: 'Shift updated' })
      } else {
        await createShift({
          cleanerId: value.cleanerId,
          customerId: value.customerId,
          siteName: value.siteName,
          startAt: value.startAt,
          endAt: value.endAt,
          notes: value.notes,
          createdBy: adminId || null,
        })
        toast({ title: 'Shift created' })
      }
      setDialogState({ open: false, mode: 'create' })
      await loadShifts()
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not save shift', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (shiftId: string) => {
    setIsSubmitting(true)
    try {
      await deleteShift(shiftId)
      toast({ title: 'Shift deleted' })
      setDialogState({ open: false, mode: 'create' })
      await loadShifts()
    } catch (err) {
      console.error(err)
      toast({ title: 'Could not delete shift', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-[#007AFF]" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="admin" userName={userName}>
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                Schedule
              </p>
              <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">
                {format(weekStart, 'MMMM yyyy')}
              </h1>
              <p className="mt-0.5 text-[13px] text-gray-500">
                {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-white p-1 ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setWeekAnchor((prev) => addWeeks(prev, -1))}
                  aria-label="Previous week"
                  className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setWeekAnchor(new Date())}
                  className="h-8 rounded-full px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-100"
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setWeekAnchor((prev) => addWeeks(prev, 1))}
                  aria-label="Next week"
                  className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                onClick={() => openCreate(new Date(), new Date().getHours())}
                className="h-10 rounded-full bg-[#007AFF] px-4 text-[13px] font-semibold text-white shadow-none hover:bg-[#0064D2]"
              >
                <Plus className="mr-1 h-4 w-4" />
                New shift
              </Button>
            </div>
          </div>

          <WeeklyScheduleGrid
            weekStart={weekStart}
            blocks={blocks}
            onCreate={openCreate}
            onSelect={openEdit}
            isLoading={isLoading}
          />
        </div>
      </div>

      <ShiftDialog
        open={dialogState.open}
        mode={dialogState.mode}
        initialDay={dialogState.day}
        initialHour={dialogState.hour}
        shift={dialogState.shift ?? null}
        cleaners={cleanerOptions}
        customers={customerOptions}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        onOpenChange={closeDialog}
      />
    </Sidebar07Layout>
  )
}

export default AdminWeeklySchedulePage
