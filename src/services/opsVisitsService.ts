import { formatISO } from 'date-fns'
import { supabase } from './supabase'

export interface OpsSiteVisit {
  id: string
  siteId: string | null
  siteName: string
  customerName: string | null
  scheduledFor: string
  visitedAt: string | null
  notes: string | null
}

export interface UpsertOpsVisitInput {
  siteId?: string
  siteName: string
  customerName?: string | null
  scheduledFor: Date
  notes?: string
}

export async function fetchOpsVisits(managerId: string, range: { start: Date; end: Date }): Promise<OpsSiteVisit[]> {
  if (!managerId) return []

  const { data, error } = await supabase
    .from('ops_site_visits')
    .select('id, site_id, site_name, customer_name, scheduled_for, visited_at, notes')
    .eq('ops_manager_id', managerId)
    .gte('scheduled_for', formatISO(range.start, { representation: 'date' }))
    .lte('scheduled_for', formatISO(range.end, { representation: 'date' }))
    .order('scheduled_for', { ascending: true })

  if (error) {
    console.error('Failed to fetch ops visits', error)
    return []
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    siteId: row.site_id ?? null,
    siteName: row.site_name ?? null,
    customerName: row.customer_name ?? null,
    scheduledFor: row.scheduled_for,
    visitedAt: row.visited_at,
    notes: row.notes ?? null,
  }))
}

export async function scheduleOpsVisit(managerId: string, input: UpsertOpsVisitInput): Promise<OpsSiteVisit> {
  if (!managerId) {
    throw new Error('Missing ops manager id')
  }

  const payload = {
    ops_manager_id: managerId,
    site_id: input.siteId ?? null,
    site_name: input.siteName,
    customer_name: input.customerName ?? null,
    scheduled_for: formatISO(input.scheduledFor, { representation: 'date' }),
    notes: input.notes ?? null,
  }

  const { data, error } = await supabase
    .from('ops_site_visits')
    .insert(payload)
    .select('id, site_id, site_name, customer_name, scheduled_for, visited_at, notes')
    .single()

  if (error) {
    console.error('Failed to schedule ops visit', error)
    throw error
  }

  return {
    id: data.id,
    siteId: data.site_id ?? null,
    siteName: data.site_name ?? null,
    customerName: data.customer_name ?? null,
    scheduledFor: data.scheduled_for,
    visitedAt: data.visited_at,
    notes: data.notes ?? null,
  }
}

export async function logOpsVisit(visitId: string): Promise<void> {
  if (!visitId) return

  const { error } = await supabase
    .from('ops_site_visits')
    .update({ visited_at: new Date().toISOString() })
    .eq('id', visitId)

  if (error) {
    console.error('Failed to log ops visit', error)
    throw error
  }
}

export async function deleteOpsVisit(visitId: string): Promise<void> {
  if (!visitId) return

  const { error } = await supabase.from('ops_site_visits').delete().eq('id', visitId)

  if (error) {
    console.error('Failed to delete ops visit', error)
    throw error
  }
}


