import { supabase, BathroomAssistRequest, BathroomAssistEvent } from './supabase'

export type AssistMedia = {
  type: 'before' | 'after'
  url: string
  name?: string
  size?: number
}

export type CreateAssistRequestInput = {
  qrCodeId?: string
  customerName: string
  locationLabel: string
  issueType: string
  issueDescription?: string
  reportedBy?: string
  reportedContact?: string
  beforeMedia?: AssistMedia[]
  metadata?: Record<string, any>
  escalateAfter?: string
}

export type AcceptAssistRequestInput = {
  requestId: string
  cleanerId: string
  cleanerName: string
}

export type ResolveAssistRequestInput = {
  requestId: string
  cleanerId: string
  cleanerName: string
  notes?: string
  materialsUsed?: string
  afterMedia?: AssistMedia[]
}

export type ListResolvedOptions = {
  customerName?: string
  locationLabel?: string
  status?: Array<BathroomAssistRequest['status']>
  limit?: number
}

export type ListRecentOptions = {
  statuses?: Array<BathroomAssistRequest['status']>
  customerName?: string
  limit?: number
}

const sanitizeMedia = (media?: AssistMedia[] | null) =>
  (media || []).map((item) => ({
    ...item,
    type: item.type || 'before'
  }))

const queueNotification = async (recipient: string, content: string, payload?: Record<string, any>) => {
  try {
    await supabase.from('messages').insert({
      recipient,
      type: 'bathroom_assist',
      content,
      schedule: null,
      cleaner_name: payload?.cleanerName ?? null,
      cleaner_id: payload?.cleanerId ?? null,
      customer_name: payload?.customerName ?? null
    })
  } catch (error) {
    console.warn('Failed to queue notification', error)
  }
}

export class AssistRequestService {
  static async listPendingForCleaner(cleanerId: string, customerName?: string) {
    const query = supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .select('*')
      .in('status', ['pending', 'accepted', 'escalated'])
      .order('reported_at', { ascending: true })

    if (customerName) {
      query.eq('customer_name', customerName)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  }

  static async listResolved(options: ListResolvedOptions = {}) {
    const query = supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .select('*')
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .limit(options.limit ?? 10)

    if (options.customerName) {
      query.eq('customer_name', options.customerName)
    }

    if (options.locationLabel) {
      query.eq('location_label', options.locationLabel)
    }

    if (options.status?.length) {
      query.in('status', options.status)
    } else {
      query.in('status', ['resolved', 'escalated'])
    }

    const { data, error } = await query
    if (error) throw error
    return data
  }

  static async listRecent(options: ListRecentOptions = {}) {
    const query = supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .select('*')
      .order('reported_at', { ascending: false })
      .limit(options.limit ?? 20)

    if (options.customerName) {
      query.eq('customer_name', options.customerName)
    }
    if (options.statuses?.length) {
      query.in('status', options.statuses)
    }

    const { data, error } = await query
    if (error) throw error
    return data
  }

  static async create(input: CreateAssistRequestInput) {
    const id = crypto.randomUUID()
    const row = {
      id,
      qr_code_id: input.qrCodeId || null,
      customer_name: input.customerName,
      location_label: input.locationLabel,
      issue_type: input.issueType,
      issue_description: input.issueDescription || null,
      reported_by: input.reportedBy || null,
      reported_contact: input.reportedContact || null,
      before_media: sanitizeMedia(input.beforeMedia),
      metadata: input.metadata || {},
      escalate_after: input.escalateAfter || null
    }

    const { error } = await supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .insert(row, { returning: 'minimal' })

    if (error) throw error

    await this.logEvent({
      request_id: id,
      event_type: 'reported',
      actor_role: 'staff',
      actor_name: input.reportedBy || 'Anonymous',
      payload: {
        issue: input.issueType,
        description: input.issueDescription || null,
        attachments: sanitizeMedia(input.beforeMedia)
      }
    })

    await queueNotification('cleaners', `New bathroom assist reported at ${input.locationLabel}`, {
      customerName: input.customerName
    })

    return { id }
  }

  static async accept(input: AcceptAssistRequestInput) {
    const { data, error } = await supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: input.cleanerId,
        accepted_by_name: input.cleanerName
      })
      .eq('id', input.requestId)
      .select('*')
      .single()

    if (error) throw error
    await this.logEvent({
      request_id: input.requestId,
      event_type: 'accepted',
      actor_role: 'cleaner',
      actor_id: input.cleanerId,
      actor_name: input.cleanerName
    })
    await queueNotification('operations', `${input.cleanerName} accepted bathroom assist request`, {
      cleanerId: input.cleanerId,
      cleanerName: input.cleanerName,
      customerName: data.customer_name
    })
    return data
  }

  static async resolve(input: ResolveAssistRequestInput) {
    const { data, error } = await supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: input.cleanerId,
        resolved_by_name: input.cleanerName,
        after_media: sanitizeMedia(input.afterMedia),
        notes: input.notes || null,
        materials_used: input.materialsUsed || null
      })
      .eq('id', input.requestId)
      .select('*')
      .single()

    if (error) throw error
    await this.logEvent({
      request_id: input.requestId,
      event_type: 'resolved',
      actor_role: 'cleaner',
      actor_id: input.cleanerId,
      actor_name: input.cleanerName,
      payload: {
        notes: input.notes || null,
        materialsUsed: input.materialsUsed || null,
        attachments: sanitizeMedia(input.afterMedia)
      }
    })
    await queueNotification('customers', `Bathroom issue resolved in ${data.location_label}`, {
      cleanerId: input.cleanerId,
      cleanerName: input.cleanerName,
      customerName: data.customer_name
    })
    return data
  }

  static async escalateOverdueRequests(reason = 'No cleaner accepted in time') {
    const { data, error } = await supabase
      .from<BathroomAssistRequest>('bathroom_assist_requests')
      .update({
        status: 'escalated',
        escalated_at: new Date().toISOString(),
        escalation_reason: reason
      })
      .eq('status', 'pending')
      .lte('escalate_after', new Date().toISOString())
      .select('*')

    if (error) throw error

    await Promise.all(
      (data ?? []).map((request) =>
        Promise.all([
          this.logEvent({
            request_id: request.id,
            event_type: 'escalated',
            actor_role: 'system',
            payload: {
              reason,
              escalateAfter: request.escalate_after
            }
          }),
          queueNotification('operations', `Bathroom assist escalated at ${request.location_label}`, {
            customerName: request.customer_name
          })
        ])
      )
    )

    return data ?? []
  }

  static async logEvent(event: Partial<BathroomAssistEvent> & { request_id: string; event_type: string }) {
    const { error } = await supabase
      .from<BathroomAssistEvent>('bathroom_assist_events')
      .insert({
        request_id: event.request_id,
        event_type: event.event_type,
        actor_role: event.actor_role || null,
        actor_id: event.actor_id || null,
        actor_name: event.actor_name || null,
        payload: event.payload || {}
      })

    if (error) throw error
  }
}
