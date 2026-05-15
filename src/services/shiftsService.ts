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
  cleaners?: { first_name: string | null; last_name: string | null } | null
  customer?: { name: string | null; display_name: string | null } | null
}

const SELECT_COLUMNS =
  'id, cleaner_id, customer_id, site_name, start_at, end_at, notes, created_by, created_at, updated_at, cleaners ( first_name, last_name ), customer:uk_customers ( name, display_name )'

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
