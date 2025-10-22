import QRCode from 'qrcode'
import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'
import { getStoredCleanerName, normalizeCleanerNumericId } from '../lib/identity'

export type AreaType = 
  | 'BATHROOMS_ABLUTIONS'
  | 'ADMIN_OFFICE'
  | 'GENERAL_AREAS'
  | 'WAREHOUSE_INDUSTRIAL'
  | 'KITCHEN_CANTEEN'
  | 'RECEPTION_COMMON'

export interface TaskDefinition {
  id: string
  name: string
  category: AreaType
  description?: string
  isRequired?: boolean
}

export interface QRCodeData {
  id: string
  type: 'CLOCK_IN' | 'CLOCK_OUT' | 'AREA' | 'TASK' | 'FEEDBACK'
  siteId?: string
  areaId?: string
  taskId?: string
  customerName?: string
  areaType?: AreaType
  metadata?: Record<string, any>
}

export interface TaskSelection {
  cleanerId: string
  qrCodeId: string
  areaType: AreaType
  selectedTasks: string[]
  timestamp: string
  completedTasks?: string[]
}

export interface ManualQRCodePayload {
  type: QRCodeData['type']
  customerName: string
  siteName?: string
  siteId?: string
  areaName?: string
  areaId?: string
  description?: string
  floor?: string
  category?: string
  label?: string
  notes?: string
  metadata?: Record<string, any>
}

export interface ManualQRCodeResult {
  qrData: QRCodeData
  dataUrl: string
  storageUrl: string
  storagePath: string
}

export const AREA_TASKS: Record<AreaType, TaskDefinition[]> = {
  BATHROOMS_ABLUTIONS: [
    { id: 'bath_clean_toilets', name: 'Clean toilets', category: 'BATHROOMS_ABLUTIONS' },
    { id: 'bath_clean_urinals', name: 'Clean urinals', category: 'BATHROOMS_ABLUTIONS' },
    { id: 'bath_clean_sinks', name: 'Clean sinks', category: 'BATHROOMS_ABLUTIONS' },
    { id: 'bath_wipe_mirrors', name: 'Wipe mirrors', category: 'BATHROOMS_ABLUTIONS' },
    { id: 'bath_empty_bins', name: 'Empty waste bins', category: 'BATHROOMS_ABLUTIONS' },
    { id: 'bath_replenish_supplies', name: 'Replenish: hand paper towels, toilet rolls, soap', category: 'BATHROOMS_ABLUTIONS' },
    { id: 'bath_mop_floors', name: 'Mop floors', category: 'BATHROOMS_ABLUTIONS' }
  ],
  ADMIN_OFFICE: [
    { id: 'office_wipe_desks', name: 'Wipe desks and workstations', category: 'ADMIN_OFFICE' },
    { id: 'office_reset_meetings', name: 'Reset meeting rooms (tables, chairs, presentation surfaces)', category: 'ADMIN_OFFICE' },
    { id: 'office_vacuum_floors', name: 'Vacuum floors', category: 'ADMIN_OFFICE' },
    { id: 'office_empty_bins', name: 'Empty waste bins', category: 'ADMIN_OFFICE' },
    { id: 'office_dust_computers', name: 'Dust computers and monitors', category: 'ADMIN_OFFICE' },
    { id: 'office_wipe_phones', name: 'Wipe phones and headsets', category: 'ADMIN_OFFICE' },
    { id: 'office_clean_switches', name: 'Clean light switches and touch points', category: 'ADMIN_OFFICE' }
  ],
  GENERAL_AREAS: [
    { id: 'general_floor_care', name: 'Vacuum, mop, or sweep floors (as appropriate)', category: 'GENERAL_AREAS' },
    { id: 'general_remove_waste', name: 'Remove waste and litter', category: 'GENERAL_AREAS' },
    { id: 'general_wipe_handrails', name: 'Wipe handrails and banisters', category: 'GENERAL_AREAS' },
    { id: 'general_clean_glass', name: 'Clean glass panels and internal doors', category: 'GENERAL_AREAS' }
  ],
  WAREHOUSE_INDUSTRIAL: [
    { id: 'warehouse_floor_care', name: 'Sweep, mop, or vacuum floors', category: 'WAREHOUSE_INDUSTRIAL' },
    { id: 'warehouse_remove_waste', name: 'Remove waste and pallets', category: 'WAREHOUSE_INDUSTRIAL' },
    { id: 'warehouse_tidy_racking', name: 'Keep racking/shelving areas tidy', category: 'WAREHOUSE_INDUSTRIAL' }
  ],
  KITCHEN_CANTEEN: [
    { id: 'kitchen_wipe_surfaces', name: 'Wipe all surfaces and counters', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_clean_sinks', name: 'Clean sinks and taps', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_wipe_appliances', name: 'Wipe appliances (microwaves, kettles, coffee machines)', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_clean_fridges', name: 'Clean fridges (internal & external, weekly/monthly deep as required)', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_clean_dishwashers', name: 'Clean dishwashers (internal & external)', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_sanitise_tables', name: 'Wipe and sanitise tables and chairs', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_mop_floors', name: 'Mop floors', category: 'KITCHEN_CANTEEN' },
    { id: 'kitchen_remove_waste', name: 'Remove waste and recycling', category: 'KITCHEN_CANTEEN' }
  ],
  RECEPTION_COMMON: [
    { id: 'reception_clean_glass', name: 'Clean glass doors and partitions', category: 'RECEPTION_COMMON' },
    { id: 'reception_wipe_counters', name: 'Wipe counters and reception desks', category: 'RECEPTION_COMMON' },
    { id: 'reception_arrange_chairs', name: 'Clean and arrange waiting area chairs', category: 'RECEPTION_COMMON' },
    { id: 'reception_remove_waste', name: 'Remove waste and recycling', category: 'RECEPTION_COMMON' }
  ]
}

export class QRService {
  private static normalizeLabel(value?: string | null) {
    if (!value) return ''
    const trimmed = value.toString().trim()
    if (!trimmed || /unknown site/i.test(trimmed)) return ''
    return trimmed
  }

  private static deriveSiteLabel(qrData: QRCodeData, siteId?: string) {
    const metadataSite = this.normalizeLabel(qrData.metadata?.siteName ?? qrData.metadata?.areaName)
    if (metadataSite) return metadataSite

    const customerName = this.normalizeLabel(qrData.customerName)
    if (customerName) return customerName

    const fallback = this.normalizeLabel(siteId)
    if (fallback) return fallback

    return 'Site'
  }

  private static deriveCustomerLabel(qrData: QRCodeData, siteLabel: string) {
    const customerName = this.normalizeLabel(qrData.customerName)
    return customerName || siteLabel
  }

  static async saveRemoteDraft(draft: any) {
    try {
      const cleanerName = getStoredCleanerName()
      await supabase
        .from('work_drafts')
        .upsert({
          cleaner_id: draft.cleanerId,
          cleaner_name: cleanerName,
          qr_code_id: draft.qrCodeId,
          area_type: draft.areaType,
          step: draft.step,
          current_task_index: draft.currentTaskIndex,
          state: draft.state,
          is_finalized: false
        }, { onConflict: 'id' })
    } catch (e) {
      console.warn('saveRemoteDraft failed (will retry later):', e)
    }
  }

  static async fetchRemoteDraft(cleanerId: string) {
    try {
      const { data } = await supabase
        .from('work_drafts')
        .select('*')
        .eq('cleaner_id', cleanerId)
        .eq('is_finalized', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data || null
    } catch (e) {
      console.warn('fetchRemoteDraft failed:', e)
      return null
    }
  }

  static async finalizeRemoteDraft(cleanerId: string) {
    try {
      await supabase
        .from('work_drafts')
        .update({ is_finalized: true })
        .eq('cleaner_id', cleanerId)
        .eq('is_finalized', false)
    } catch (e) {
      console.warn('finalizeRemoteDraft failed:', e)
    }
  }

  static sanitizeSegment(value?: string | null) {
    return (value ?? 'unknown')
      .toString()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'unknown'
  }

  private static prettifySiteLabel(value?: string | null) {
    if (!value) return ''
    const trimmed = value.toString().trim()
    if (!trimmed || /unknown site/i.test(trimmed)) return ''

    const normalized = trimmed
      .replace(/[_-]+/g, ' ')
      .replace(/\b(clock[-\s]?in|clock[-\s]?out|check[-\s]?in|check[-\s]?out|qr|site)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!normalized) return ''

    return normalized
      .split(' ')
      .filter(Boolean)
      .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
      .join(' ')
  }

  private static describeAreaTask(type: QRCodeData['type'], areaName: string) {
    switch (type) {
      case 'CLOCK_IN':
        return `Clock in checkpoint – ${areaName}`
      case 'CLOCK_OUT':
        return `Clock out checkpoint – ${areaName}`
      case 'TASK':
        return `Task QR – ${areaName}`
      case 'FEEDBACK':
        return `Feedback QR – ${areaName}`
      default:
        return `${areaName}`
    }
  }

  static async ensureAreaTaskRecord(
    qrData: QRCodeData,
    customerName?: string,
    areaName?: string,
    description?: string
  ) {
    try {
      const normalizedCustomer = (customerName || 'Unassigned Customer').trim() || 'Unassigned Customer'
      const normalizedArea = (areaName || 'Unassigned Area').trim() || 'Unassigned Area'
      const normalizedType = qrData.type?.trim().toUpperCase() || 'AREA'
      const taskDescription = description?.trim() || this.describeAreaTask(qrData.type, normalizedArea)

      const { data: existing, error: fetchError } = await supabase
        .from('area_tasks')
        .select('id')
        .eq('qr_code', qrData.id)
        .maybeSingle()

      if (fetchError) {
        console.error('Failed to read existing area task', fetchError)
        return
      }

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from('area_tasks')
          .update({
            customer_name: normalizedCustomer,
            area: normalizedArea,
            task_description: taskDescription,
            task_type: normalizedType,
            active: true,
          })
          .eq('id', existing.id)

        if (updateError) {
          console.error('Failed to update area task', updateError)
        }
      } else {
        const { error: insertError } = await supabase
          .from('area_tasks')
          .insert({
            customer_name: normalizedCustomer,
            area: normalizedArea,
            task_description: taskDescription,
            task_type: normalizedType,
            qr_code: qrData.id,
            active: true,
          })

        if (insertError) {
          console.error('Failed to insert area task', insertError)
        }
      }
    } catch (areaTaskError) {
      console.error('Error ensuring area task record', areaTaskError)
    }
  }

  private static defaultAreaDescription(type: QRCodeData['type']) {
    switch (type) {
      case 'CLOCK_IN':
        return 'Clock In QR Code'
      case 'CLOCK_OUT':
        return 'Clock Out QR Code'
      case 'TASK':
        return 'Task QR Code'
      case 'FEEDBACK':
        return 'Feedback QR Code'
      default:
        return 'Area QR Code'
    }
  }

  static async createManualQRCode(payload: ManualQRCodePayload): Promise<ManualQRCodeResult> {
    const trimmedCustomer = payload.customerName?.trim()

    if (!trimmedCustomer) {
      throw new Error('Customer name is required')
    }

    const now = new Date().toISOString()
    const metadata = {
      ...payload.metadata,
      siteName: payload.siteName?.trim() || undefined,
      areaName: payload.areaName?.trim() || undefined,
      floor: payload.floor?.trim() || undefined,
      category: payload.category?.trim() || undefined,
      label: payload.label?.trim() || undefined,
      notes: payload.notes?.trim() || undefined,
      generatedAt: now,
    }

    const qrData: QRCodeData = {
      id: uuidv4(),
      type: payload.type,
      siteId: payload.siteId?.trim() || undefined,
      areaId: payload.areaId?.trim() || undefined,
      taskId: payload.type === 'TASK' ? payload.metadata?.taskId || uuidv4() : undefined,
      customerName: trimmedCustomer,
      metadata,
    }

    const dataUrl = await this.generateQRCode(qrData)

    try {
      const bucket = supabase.storage.from('qr-codes')
      const sanitizedCustomer = this.sanitizeSegment(trimmedCustomer)
      const areaSegment = this.sanitizeSegment(metadata.areaName || metadata.siteName || payload.type)
      const storagePath = `manual/${sanitizedCustomer}/${areaSegment}/${qrData.id}.png`

      const response = await fetch(dataUrl)
      const blob = await response.blob()

      const { error: uploadError } = await bucket.upload(storagePath, blob, {
        upsert: true,
        contentType: 'image/png',
      })

      if (uploadError) {
        throw uploadError
      }

      const { data: publicUrlData } = bucket.getPublicUrl(storagePath)
      const storageUrl = publicUrlData?.publicUrl || storagePath

      const { error: insertError } = await supabase
        .from('building_qr_codes')
        .upsert({
          qr_code_id: qrData.id,
          customer_name: trimmedCustomer,
          building_area: metadata.areaName || metadata.siteName || payload.type,
          area_description: payload.description?.trim() || this.defaultAreaDescription(payload.type),
          qr_code_url: JSON.stringify(qrData),
          qr_code_image_path: storageUrl,
          is_active: true,
          created_at: now,
        }, { onConflict: 'qr_code_id' })

      if (insertError) {
        throw insertError
      }

      await this.ensureAreaTaskRecord(qrData, trimmedCustomer, metadata.areaName || metadata.siteName || payload.type, payload.description)

      return {
        qrData,
        dataUrl,
        storageUrl,
        storagePath,
      }
    } catch (error) {
      console.error('Failed to create manual QR code:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to create manual QR code')
    }
  }
  /** Build QR data from non-JSON plain text (best-effort). */
  static fromPlainText(text: string): QRCodeData {
    const raw = (text || '').trim()
    const lower = raw.toLowerCase()
    let type: QRCodeData['type'] = 'AREA'
    if (lower.includes('clock') && (lower.includes('in') || lower.includes('clock-in'))) type = 'CLOCK_IN'
    else if (lower.includes('clock') && (lower.includes('out') || lower.includes('clock-out'))) type = 'CLOCK_OUT'
    else if (lower.includes('feedback')) type = 'FEEDBACK'
    else if (lower.includes('task')) type = 'TASK'

    // Very loose extraction of names (first token as customer/site hint)
    const firstToken = raw.split(/\s|[:\-–]/)[0]

    return {
      // Use the original text as a stable identifier so scans match uploaded entries
      id: raw,
      type,
      customerName: firstToken && firstToken.length <= 30 ? firstToken : undefined,
      metadata: {
        originalText: raw,
        areaName: raw
      }
    }
  }
  /**
   * Generate QR code for different purposes
   */
  static async generateQRCode(data: QRCodeData): Promise<string> {
    try {
      const qrData = JSON.stringify(data)
      const qrCodeDataURL = await QRCode.toDataURL(qrData, {
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
      return qrCodeDataURL
    } catch (error) {
      console.error('Error generating QR code:', error)
      throw new Error('Failed to generate QR code')
    }
  }

  /**
   * Generate Clock-In QR Code for a site
   */
  static async generateClockInQR(siteId: string, customerName: string, siteName?: string): Promise<string> {
    const qrData: QRCodeData = {
      id: uuidv4(),
      type: 'CLOCK_IN',
      siteId,
      customerName,
      metadata: {
        action: 'clock_in',
        timestamp: new Date().toISOString(),
        siteName: siteName || undefined
      }
    }
    return this.generateQRCode(qrData)
  }

  /**
   * Generate Clock-Out QR Code for a site
   */
  static async generateClockOutQR(siteId: string, customerName: string, siteName?: string): Promise<string> {
    const qrData: QRCodeData = {
      id: uuidv4(),
      type: 'CLOCK_OUT',
      siteId,
      customerName,
      metadata: {
        action: 'clock_out',
        timestamp: new Date().toISOString(),
        siteName: siteName || undefined
      }
    }
    return this.generateQRCode(qrData)
  }

  /**
   * Generate Area QR Code for cleaning areas
   */
  static async generateAreaQR(areaId: string, customerName: string, areaName: string): Promise<string> {
    const qrData: QRCodeData = {
      id: uuidv4(),
      type: 'AREA',
      areaId,
      customerName,
      metadata: {
        areaName,
        timestamp: new Date().toISOString()
      }
    }
    return this.generateQRCode(qrData)
  }

  /**
   * Generate Task QR Code for specific cleaning tasks
   */
  static async generateTaskQR(taskId: string, areaId: string, customerName: string): Promise<string> {
    const qrData: QRCodeData = {
      id: uuidv4(),
      type: 'TASK',
      taskId,
      areaId,
      customerName,
      metadata: {
        timestamp: new Date().toISOString()
      }
    }
    return this.generateQRCode(qrData)
  }

  /**
   * Parse QR code data
   */
  static parseQRCode(qrString: string): QRCodeData | null {
    try {
      // Accept either raw JSON or "KEY: value" lines inside text files
      const trimmed = qrString.trim()
      if (!trimmed) return null

      // If it's JSON, parse directly; otherwise, convert plain text to a structured QR
      const data = trimmed.startsWith('{') ? JSON.parse(trimmed) : this.fromPlainText(trimmed)
      if (data.id && data.type) {
        return data as QRCodeData
      }
      return null
    } catch (error) {
      console.error('Error parsing QR code:', error)
      return null
    }
  }

  /**
   * Process QR code scan and log to database
   */
  static async processQRScan(
    qrData: QRCodeData, 
    cleanerId: string, 
    cleanerName: string,
    location?: { latitude: number; longitude: number }
  ): Promise<{success: boolean, message?: string}> {
    try {
      let action = ''
      let siteArea = ''
      const siteLabelRaw = this.deriveSiteLabel(qrData, qrData.siteId)
      const siteLabel = this.prettifySiteLabel(siteLabelRaw) || siteLabelRaw || 'Site'
      // Database should be configured now

      switch (qrData.type) {
        case 'CLOCK_IN':
          action = 'Clock In'
          siteArea = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
          
          // Check if already clocked in
          const alreadyClockedIn = await this.isAlreadyClockedIn(cleanerId)
          if (alreadyClockedIn) {
            return { 
              success: false, 
              message: 'You are already clocked in. Please clock out first or scan an area QR code to continue working.' 
            }
          }
          
          const clockInResult = await this.logClockEvent(cleanerId, qrData.siteId!, 'clock_in', qrData.id, qrData)
          if (!clockInResult.success) {
            return { success: false, message: clockInResult.message }
          }
          break
          
        case 'CLOCK_OUT':
          action = 'Clock Out'
          siteArea = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
          
          // Check if already clocked out
          const cleanerName = getStoredCleanerName()
          console.log('Clock-out validation for:', cleanerName)
          
          const alreadyClockedOut = await this.isAlreadyClockedOut(cleanerId)
          console.log('Already clocked out?', alreadyClockedOut)
          
          if (alreadyClockedOut) {
            return { 
              success: false, 
              message: `You are already clocked out, ${cleanerName}. Please scan a Clock In QR code to start working.` 
            }
          }
          
          const clockOutResult = await this.logClockEvent(cleanerId, qrData.siteId!, 'clock_out', qrData.id, qrData)
          if (!clockOutResult.success) {
            return { success: false, message: clockOutResult.message }
          }
          break
          
        case 'AREA':
          action = 'Area Scan'
          siteArea = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
          
          // Check if clocked in before allowing area scan
          const isClockedIn = await this.isAlreadyClockedIn(cleanerId)
          if (!isClockedIn) {
            return { 
              success: false, 
              message: 'Please clock in first before scanning area QR codes.' 
            }
          }
          break
          
        case 'TASK':
          action = 'Task Started'
          siteArea = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
          break
        default:
          action = 'QR Scan'
      }

      // Log to database
      try {
        const customerLabel = this.deriveCustomerLabel(qrData, siteLabel)
        const { error } = await supabase
          .from('cleaner_logs')
          .insert({
            cleaner_id: cleanerId,
            cleaner_name: getStoredCleanerName(),
            action: action,
            site_id: qrData.siteId,
            area_id: qrData.areaId,
            latitude: location?.latitude,
            longitude: location?.longitude,
            customer_name: customerLabel,
            site_area: siteArea,
            comments: `${siteArea} - ${customerLabel}`.trim(),
            device_info: { qr_code_scanned: qrData, device_ip: await this.getDeviceIP() },
            timestamp: new Date().toISOString()
          })

        if (error) {
          console.error('Error logging QR scan:', error)
          console.warn('QR scan processed but not logged to database')
        }

        // Update live tracking
        await this.updateLiveTracking(cleanerId, qrData, action, location)
      } catch (dbError) {
        console.error('Database error, but continuing with QR processing:', dbError)
      }

      return { success: true }
    } catch (error) {
      console.error('Error processing QR scan:', error)
      return { success: false, message: 'An error occurred while processing the QR code. Please try again.' }
    }
  }

  /**
   * Log clock in/out events
   */
  private static async logClockEvent(
    cleanerId: string, 
    siteId: string, 
    eventType: 'clock_in' | 'clock_out',
    qrCodeId: string,
    qrData: QRCodeData
  ): Promise<{success: boolean, message?: string}> {
    try {
      const cleanerName = getStoredCleanerName()
      const currentTime = new Date().toISOString()
      const siteLabelRaw = this.deriveSiteLabel(qrData, siteId)
      const siteLabel = this.prettifySiteLabel(siteLabelRaw) || siteLabelRaw || 'Site'
      const customerLabel = this.deriveCustomerLabel(qrData, siteLabel)

      if (eventType === 'clock_in') {
        // For clock-in, create a new time_attendance record
          const { error: attendanceError } = await supabase
          .from('time_attendance')
          .insert({
            cleaner_id: normalizeCleanerNumericId(cleanerId),
            cleaner_name: cleanerName,
            customer_name: customerLabel,
            site_name: siteLabel,
            clock_in: currentTime,
            clock_in_qr: qrCodeId,
            cleaner_mobile: localStorage.getItem('userMobile') || '',
            notes: 'Clock-in via QR'
          })

        if (attendanceError) {
          console.error('Error logging clock-in to time_attendance:', attendanceError)
          return { success: false, message: 'Failed to log clock-in. Please try again.' }
        }
      } else {
        // For clock-out, update the most recent open time_attendance record
        const { data: openRecord, error: findError } = await supabase
          .from('time_attendance')
          .select('*')
          .eq('cleaner_name', cleanerName)
          .is('clock_out', null)
          .order('id', { ascending: false })
          .limit(1)
          .single()

        if (findError || !openRecord) {
          console.error('Error finding open attendance record:', findError)
          return { success: false, message: 'No active clock-in found. Please clock in first.' }
        }

        const { error: updateError } = await supabase
          .from('time_attendance')
          .update({
            clock_out: currentTime,
            notes: openRecord.notes ? `${openRecord.notes} | Clock-out via QR` : 'Clock-out via QR',
            customer_name: customerLabel || openRecord.customer_name,
            site_name: siteLabel || openRecord.site_name
          })
          .eq('id', openRecord.id)

        if (updateError) {
          console.error('Error logging clock-out to time_attendance:', updateError)
          return { success: false, message: 'Failed to log clock-out. Please try again.' }
        }
      }

      // Also log to live_tracking for real-time status
      const { error: trackingError } = await supabase
        .from('live_tracking')
        .insert({
          cleaner_id: cleanerId,
          site_id: siteId,
          event_type: eventType,
          is_active: eventType === 'clock_in'
        })

      // Don't fail the whole operation if live_tracking fails
      if (trackingError) {
        console.warn('Warning: Failed to log to live_tracking:', trackingError)
      }

      return { success: true }
    } catch (error) {
      console.error('Error in logClockEvent:', error)
      return { success: false, message: 'An error occurred while logging the clock event.' }
    }
  }

  /**
   * Check if cleaner is already clocked in
   */
  private static async isAlreadyClockedIn(cleanerId: string): Promise<boolean> {
    try {
      // Check if Supabase is configured
      if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
        console.error('Supabase not configured properly')
        return false
      }

      const cleanerName = getStoredCleanerName()
      console.log('Checking if clocked in for:', cleanerName)

      // Check by cleaner_name instead of cleaner_id to handle UUID vs integer mismatch
      const { data, error } = await supabase
        .from('time_attendance')
        .select('*')
        .eq('cleaner_name', cleanerName)
        .is('clock_out', null)
        .order('id', { ascending: false })
        .limit(1)

      console.log('Database query result:', { data, error })

      if (error) {
        console.error('Error checking clock status:', error)
        // If database error, allow operation to continue
        return false
      }

      const result = data && data.length > 0
      console.log('Has open clock-in sessions?', result)
      if (result && data[0]) {
        console.log('Latest open session:', data[0])
      }

      return result
    } catch (error) {
      console.error('Error in isAlreadyClockedIn:', error)
      // If any error, allow operation to continue
      return false
    }
  }

  /**
   * Check if cleaner is already clocked out
   */
  private static async isAlreadyClockedOut(cleanerId: string): Promise<boolean> {
    try {
      // Check if Supabase is configured
      if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
        console.error('Supabase not configured properly')
        return false
      }

      const cleanerName = getStoredCleanerName()
      console.log('Checking clock-out status for:', cleanerName)

      // If there's no active clock-in, consider them clocked out
      const isActive = await this.isAlreadyClockedIn(cleanerId)
      console.log('Is currently clocked in?', isActive)
      
      const result = !isActive
      console.log('Should prevent clock-out?', result)
      
      return result
    } catch (error) {
      console.error('Error in isAlreadyClockedOut:', error)
      // If any error, allow operation to continue
      return false
    }
  }

  /**
   * Update live tracking data
   */
  private static async updateLiveTracking(
    cleanerId: string,
    qrData: QRCodeData,
    action: string,
    location?: { latitude: number; longitude: number }
  ) {
    const siteLabelRaw = this.deriveSiteLabel(qrData, qrData.siteId)
    const siteLabel = this.prettifySiteLabel(siteLabelRaw) || siteLabelRaw || 'Site'
    const customerLabel = this.deriveCustomerLabel(qrData, siteLabel)
    const areaLabel = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
    const { error } = await supabase
      .from('live_tracking')
      .upsert({
        cleaner_id: cleanerId,
        cleaner_name: getStoredCleanerName(),
        site_id: qrData.siteId,
        area_id: qrData.areaId,
        event_type: action.toLowerCase().replace(' ', '_'),
        latitude: location?.latitude,
        longitude: location?.longitude,
        customer_name: customerLabel,
        site_area: areaLabel,
        // Active while working; becomes inactive when clocked out
        is_active: action.toLowerCase() !== 'clock out'
      })

    if (error) {
      console.error('Error updating live tracking:', error)
    }
  }

  /**
   * Get device IP address
   */
  private static async getDeviceIP(): Promise<string> {
    try {
      const response = await fetch('https://api.ipify.org?format=json')
      const data = await response.json()
      return data.ip
    } catch (error) {
      console.error('Error getting IP:', error)
      return 'unknown'
    }
  }

  /**
   * Get cleaner's current status
   */
  static async getCleanerStatus(cleanerId: string) {
    const { data, error } = await supabase
      .from('live_tracking')
      .select('*')
      .eq('cleaner_id', cleanerId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('Error getting cleaner status:', error)
      return null
    }

    return data[0] || null
  }

  /**
   * Get all active cleaners with their current locations
   */
  static async getActiveCleaner() {
    const { data, error } = await supabase
      .from('live_tracking')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error getting active cleaners:', error)
      return []
    }

    return data || []
  }

  /**
   * Get tasks for a specific area type
   */
  static getTasksForArea(areaType: AreaType): TaskDefinition[] {
    return AREA_TASKS[areaType] || []
  }

  /**
   * Save task selection to database
   */
  static async saveTaskSelection(taskSelection: TaskSelection, photos?: { taskId: string; photo: string; timestamp: string }[]): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('uk_cleaner_task_selections')
        .insert({
          cleaner_id: taskSelection.cleanerId,
          cleaner_name: getStoredCleanerName(),
          qr_code_id: taskSelection.qrCodeId,
          area_type: taskSelection.areaType,
          selected_tasks: JSON.stringify(taskSelection.selectedTasks),
          timestamp: taskSelection.timestamp,
          completed_tasks: taskSelection.completedTasks ? JSON.stringify(taskSelection.completedTasks) : null
        })

      if (error) {
        console.error('Error saving task selection:', error)
        return false
      }

      // Save photos if provided
      if (photos && photos.length > 0) {
        const photoInserts = photos.map(photo => ({
          cleaner_id: taskSelection.cleanerId,
          cleaner_name: getStoredCleanerName(),
          qr_code_id: taskSelection.qrCodeId,
          task_id: photo.taskId,
          area_type: taskSelection.areaType,
          photo_data: photo.photo,
          photo_timestamp: photo.timestamp
        }))

        const { error: photoError } = await supabase
          .from('uk_cleaner_task_photos')
          .insert(photoInserts)

        if (photoError) {
          console.error('Error saving task photos:', photoError)
          // Don't fail the whole operation if just photo saving fails
        }
      }

      return true
    } catch (error) {
      console.error('Error saving task selection:', error)
      return false
    }
  }

  /**
   * Get task selections for a cleaner
   */
  static async getTaskSelections(cleanerId: string, date?: string): Promise<TaskSelection[]> {
    try {
      let query = supabase
        .from('uk_cleaner_task_selections')
        .select('*')
        .eq('cleaner_id', cleanerId)
        .order('timestamp', { ascending: false })

      if (date) {
        query = query.gte('timestamp', `${date}T00:00:00.000Z`)
                     .lt('timestamp', `${date}T23:59:59.999Z`)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error getting task selections:', error)
        return []
      }

      return (data || []).map(row => ({
        cleanerId: row.cleaner_id,
        qrCodeId: row.qr_code_id,
        areaType: row.area_type,
        selectedTasks: JSON.parse(row.selected_tasks || '[]'),
        timestamp: row.timestamp,
        completedTasks: row.completed_tasks ? JSON.parse(row.completed_tasks) : undefined
      }))
    } catch (error) {
      console.error('Error getting task selections:', error)
      return []
    }
  }

  /**
   * Update completed tasks for a task selection
   */
  static async updateCompletedTasks(qrCodeId: string, cleanerId: string, completedTasks: string[]): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('uk_cleaner_task_selections')
        .update({
          completed_tasks: JSON.stringify(completedTasks)
        })
        .eq('qr_code_id', qrCodeId)
        .eq('cleaner_id', cleanerId)

      if (error) {
        console.error('Error updating completed tasks:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Error updating completed tasks:', error)
      return false
    }
  }

  /**
   * Detect area type from QR code data or area name
   */
  static detectAreaType(qrData: QRCodeData): AreaType {
    // If area type is already specified, use it
    if (qrData.areaType) {
      return qrData.areaType
    }

    // Try to detect from area name or other metadata
    const raw = [
      qrData.metadata?.areaName,
      qrData.metadata?.originalText,
      qrData.metadata?.siteName,
      qrData.metadata?.label,
      qrData.metadata?.category,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    // Bathrooms / ablutions
    if (
      /bathroom|toilet|ablution|restroom|washroom|wc|lavatory|ladies|gents|men's|mens|women|disabled|accessible|urinal/.test(
        raw,
      )
    ) {
      return 'BATHROOMS_ABLUTIONS'
    }
    // Admin/office/meeting/HR/etc.
    if (/office|admin|meeting|boardroom|conference|hr|it|finance|accounts|training|sales/.test(raw)) {
      return 'ADMIN_OFFICE'
    }
    // Kitchen / canteen / break room
    if (/kitchen|canteen|break ?room|tea ?room|pantry|lunchroom|staff ?room|coffee/.test(raw)) {
      return 'KITCHEN_CANTEEN'
    }
    // Warehouse / industrial
    if (/warehouse|industrial|storage|stores|stock ?room|loading( bay)?|dock|workshop|factory|plant/.test(raw)) {
      return 'WAREHOUSE_INDUSTRIAL'
    }
    // Reception / common
    if (/reception|lobby|entrance|front desk|foyer|atrium/.test(raw)) {
      return 'RECEPTION_COMMON'
    }
    
    // Default to general areas if can't determine
    return 'GENERAL_AREAS'
  }
}
