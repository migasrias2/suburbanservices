import { supabase } from './supabase'

export interface CleanerShift {
  id: string
  cleanerId: string
  cleanerName: string | null
  customerId: string | null
  customerName: string | null
  siteName: string | null
  startAt: string
  endAt: string
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  /** NULL until the shift has been given to the cleaner. Drafts stay hidden from them. */
  publishedAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
}

export interface CreateShiftInput {
  cleanerId: string
  customerId?: string | null
  siteName?: string | null
  startAt: Date
  endAt: Date
  notes?: string | null
  createdBy?: string | null
}

export interface UpdateShiftInput {
  customerId?: string | null
  siteName?: string | null
  startAt?: Date
  endAt?: Date
  notes?: string | null
}

export interface ShiftRangeScope {
  cleanerId?: string
  customerIds?: string[]
  /**
   * Cleaner-facing views must pass true: an unpublished shift has not been
   * notified to anyone and showing it would start the notice clock by accident.
   */
  publishedOnly?: boolean
}

type ShiftRow = {
  id: string
  cleaner_id: string
  customer_id: string | null
  site_name: string | null
  start_at: string
  end_at: string
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  cleaners?: { first_name: string | null; last_name: string | null } | null
  customer?: { name: string | null; display_name: string | null } | null
}

const SELECT_COLUMNS =
  'id, cleaner_id, customer_id, site_name, start_at, end_at, notes, created_by, created_at, updated_at, published_at, cancelled_at, cancellation_reason, cleaners ( first_name, last_name ), customer:uk_customers ( name, display_name )'

const mapRow = (row: ShiftRow): CleanerShift => {
  const first = row.cleaners?.first_name?.trim() ?? ''
  const last = row.cleaners?.last_name?.trim() ?? ''
  const fullName = `${first} ${last}`.trim()
  const customerName =
    row.customer?.display_name?.trim() || row.customer?.name?.trim() || null
  return {
    id: row.id,
    cleanerId: row.cleaner_id,
    cleanerName: fullName || null,
    customerId: row.customer_id,
    customerName,
    siteName: row.site_name,
    startAt: row.start_at,
    endAt: row.end_at,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
  }
}

export async function fetchShiftsInRange(
  rangeStart: Date,
  rangeEnd: Date,
  scope: ShiftRangeScope = {},
): Promise<CleanerShift[]> {
  let query = supabase
    .from('cleaner_shifts')
    .select(SELECT_COLUMNS)
    .gte('start_at', rangeStart.toISOString())
    .lt('start_at', rangeEnd.toISOString())
    .order('start_at', { ascending: true })

  if (scope.cleanerId) {
    query = query.eq('cleaner_id', scope.cleanerId)
  }

  if (scope.customerIds && scope.customerIds.length > 0) {
    query = query.in('customer_id', scope.customerIds)
  }

  if (scope.publishedOnly) {
    query = query.not('published_at', 'is', null).is('cancelled_at', null)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch cleaner shifts', error)
    throw error
  }

  return ((data ?? []) as unknown as ShiftRow[]).map(mapRow)
}

export async function createShift(input: CreateShiftInput): Promise<CleanerShift> {
  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error('Shift end must be after start')
  }

  const { data, error } = await supabase
    .from('cleaner_shifts')
    .insert({
      cleaner_id: input.cleanerId,
      customer_id: input.customerId ?? null,
      site_name: input.siteName ?? null,
      start_at: input.startAt.toISOString(),
      end_at: input.endAt.toISOString(),
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    console.error('Failed to create cleaner shift', error)
    throw error
  }

  return mapRow(data as unknown as ShiftRow)
}

export async function updateShift(shiftId: string, input: UpdateShiftInput): Promise<CleanerShift> {
  if (input.startAt && input.endAt && input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error('Shift end must be after start')
  }

  const patch: Record<string, unknown> = {}
  if (input.customerId !== undefined) patch.customer_id = input.customerId
  if (input.siteName !== undefined) patch.site_name = input.siteName
  if (input.startAt !== undefined) patch.start_at = input.startAt.toISOString()
  if (input.endAt !== undefined) patch.end_at = input.endAt.toISOString()
  if (input.notes !== undefined) patch.notes = input.notes

  const { data, error } = await supabase
    .from('cleaner_shifts')
    .update(patch)
    .eq('id', shiftId)
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    console.error('Failed to update cleaner shift', error)
    throw error
  }

  return mapRow(data as unknown as ShiftRow)
}

export async function deleteShift(shiftId: string): Promise<void> {
  const { error } = await supabase.from('cleaner_shifts').delete().eq('id', shiftId)
  if (error) {
    console.error('Failed to delete cleaner shift', error)
    throw error
  }
}

/**
 * Make a shift visible to the cleaner. This is the moment notice is given, so
 * the audit trigger records it — republishing an already-published shift is a
 * no-op rather than a second notice event.
 */
export async function publishShifts(shiftIds: string[]): Promise<number> {
  if (!shiftIds.length) return 0

  const { data, error } = await supabase
    .from('cleaner_shifts')
    .update({ published_at: new Date().toISOString() })
    .in('id', shiftIds)
    .is('published_at', null)
    .select('id')

  if (error) {
    console.error('Failed to publish shifts', error)
    throw error
  }

  return data?.length ?? 0
}

/**
 * Cancel rather than delete. A deleted shift loses the notice history that
 * decides whether cancellation compensation is owed.
 */
export async function cancelShift(shiftId: string, reason: string): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('A cancellation reason is required')

  const { error } = await supabase
    .from('cleaner_shifts')
    .update({ cancelled_at: new Date().toISOString(), cancellation_reason: trimmed })
    .eq('id', shiftId)

  if (error) {
    console.error('Failed to cancel shift', error)
    throw error
  }
}

export interface ShiftNoticeEvent {
  id: string
  shiftId: string
  cleanerId: string
  cleanerName: string | null
  changeType: 'created' | 'published' | 'rescheduled' | 'cancelled' | 'deleted' | 'edited'
  changedAt: string
  noticeHours: number | null
  detail: string | null
  isShortNotice: boolean
}

/** Changes made at short notice — the ones that may attract compensation. */
export async function fetchShortNoticeEvents(sinceDays = 90): Promise<ShiftNoticeEvent[]> {
  const since = new Date()
  since.setDate(since.getDate() - sinceDays)

  const { data, error } = await supabase
    .from('cleaner_shift_notice_log')
    .select('id, shift_id, cleaner_id, cleaner_name, change_type, changed_at, notice_hours, detail, is_short_notice')
    .eq('is_short_notice', true)
    .gte('changed_at', since.toISOString())
    .order('changed_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Failed to load shift notice log', error)
    throw error
  }

  type NoticeRow = {
    id: string
    shift_id: string
    cleaner_id: string
    cleaner_name: string | null
    change_type: ShiftNoticeEvent['changeType']
    changed_at: string
    notice_hours: number | null
    detail: string | null
    is_short_notice: boolean | null
  }

  return ((data ?? []) as NoticeRow[]).map((row) => ({
    id: row.id,
    shiftId: row.shift_id,
    cleanerId: row.cleaner_id,
    cleanerName: row.cleaner_name,
    changeType: row.change_type,
    changedAt: row.changed_at,
    noticeHours: row.notice_hours,
    detail: row.detail,
    isShortNotice: row.is_short_notice === true,
  }))
}
