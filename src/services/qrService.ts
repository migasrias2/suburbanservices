import QRCode from 'qrcode'
import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'

export interface QRCodeData {
  id: string
  type: 'CLOCK_IN' | 'CLOCK_OUT' | 'AREA' | 'TASK' | 'FEEDBACK'
  siteId?: string
  areaId?: string
  taskId?: string
  customerName?: string
  metadata?: Record<string, any>
}

export class QRService {
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
  static async generateClockInQR(siteId: string, customerName: string): Promise<string> {
    const qrData: QRCodeData = {
      id: uuidv4(),
      type: 'CLOCK_IN',
      siteId,
      customerName,
      metadata: {
        action: 'clock_in',
        timestamp: new Date().toISOString()
      }
    }
    return this.generateQRCode(qrData)
  }

  /**
   * Generate Clock-Out QR Code for a site
   */
  static async generateClockOutQR(siteId: string, customerName: string): Promise<string> {
    const qrData: QRCodeData = {
      id: uuidv4(),
      type: 'CLOCK_OUT',
      siteId,
      customerName,
      metadata: {
        action: 'clock_out',
        timestamp: new Date().toISOString()
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
      const data = JSON.parse(qrString)
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
  ): Promise<boolean> {
    try {
      let action = ''
      let siteArea = ''

      switch (qrData.type) {
        case 'CLOCK_IN':
          action = 'Clock In'
          siteArea = qrData.metadata?.areaName || 'Site Entrance'
          await this.logClockEvent(cleanerId, qrData.siteId!, 'clock_in', qrData.id)
          break
        case 'CLOCK_OUT':
          action = 'Clock Out'
          siteArea = qrData.metadata?.areaName || 'Site Exit'
          await this.logClockEvent(cleanerId, qrData.siteId!, 'clock_out', qrData.id)
          break
        case 'AREA':
          action = 'Area Scan'
          siteArea = qrData.metadata?.areaName || 'Unknown Area'
          break
        case 'TASK':
          action = 'Task Started'
          siteArea = qrData.metadata?.areaName || 'Task Area'
          break
        default:
          action = 'QR Scan'
      }

      // Log to uk_cleaner_logs
      const { error } = await supabase
        .from('uk_cleaner_logs')
        .insert({
          cleaner_name: cleanerName,
          site_area: siteArea,
          action: action,
          qr_code_scanned: JSON.stringify(qrData),
          timestamp: new Date().toISOString(),
          customer_name: qrData.customerName,
          latitude: location?.latitude,
          longitude: location?.longitude,
          device_ip: await this.getDeviceIP(),
          qr_code: qrData.id
        })

      if (error) {
        console.error('Error logging QR scan:', error)
        return false
      }

      // Update live tracking
      await this.updateLiveTracking(cleanerId, qrData, action, location)

      return true
    } catch (error) {
      console.error('Error processing QR scan:', error)
      return false
    }
  }

  /**
   * Log clock in/out events
   */
  private static async logClockEvent(
    cleanerId: string, 
    siteId: string, 
    eventType: 'clock_in' | 'clock_out',
    qrCodeId: string
  ) {
    const { error } = await supabase
      .from('uk_cleaner_live_tracking')
      .insert({
        cleaner_id: cleanerId,
        site_id: siteId,
        event_type: eventType,
        timestamp: new Date().toISOString(),
        qr_code: qrCodeId,
        is_active: eventType === 'clock_in'
      })

    if (error) {
      console.error('Error logging clock event:', error)
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
    const { error } = await supabase
      .from('uk_cleaner_live_tracking')
      .upsert({
        cleaner_id: cleanerId,
        site_id: qrData.siteId,
        area_id: qrData.areaId,
        event_type: action.toLowerCase().replace(' ', '_'),
        timestamp: new Date().toISOString(),
        qr_code: qrData.id,
        latitude: location?.latitude,
        longitude: location?.longitude,
        is_active: true
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
      .from('uk_cleaner_live_tracking')
      .select('*')
      .eq('cleaner_id', cleanerId)
      .eq('is_active', true)
      .order('timestamp', { ascending: false })
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
      .from('uk_cleaner_live_tracking')
      .select(`
        *,
        uk_cleaners (cleaner_name, customer_name),
        uk_sites (name, customer_name, address)
      `)
      .eq('is_active', true)
      .order('timestamp', { ascending: false })

    if (error) {
      console.error('Error getting active cleaners:', error)
      return []
    }

    return data || []
  }
}
