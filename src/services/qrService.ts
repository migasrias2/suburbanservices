import QRCode from 'qrcode'
import { supabase } from './supabase'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { getStoredCleanerName, normalizeCleanerName, normalizeCleanerNumericId } from '../lib/identity'

export type AreaType = 
  | 'BATHROOMS_ABLUTIONS'
  | 'ADMIN_OFFICE'
  | 'GENERAL_AREAS'
  | 'WAREHOUSE_INDUSTRIAL'
  | 'KITCHEN_CANTEEN'
  | 'RECEPTION_COMMON'
  | 'OPS_SITE_INSPECTION'

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

export interface OpsInspectionPhoto {
  slot: number
  photo: string
  timestamp: string
}

export interface OpsInspectionPayload {
  cleanerId: string
  photos: OpsInspectionPhoto[]
  siteName?: string
  customerName?: string
  clockInTime?: string
  qrCodeId?: string
}

export interface ManualQRCodePayload {
  type: QRCodeData['type']
  customerId?: string
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
  rawValue?: string
}

export interface ManualQRCodeResult {
  qrData: QRCodeData
  dataUrl: string
  storageUrl: string
  storagePath: string
}

const isUuid = (value: string | null | undefined): boolean => {
  if (!value) {
    return false
  }
  return uuidValidate(value)
}

type TimeAttendanceRecord = {
  id: number
  cleaner_id: number | null
  cleaner_uuid: string | null
  cleaner_name: string | null
  cleaner_mobile?: string | null
  customer_name: string | null
  site_name: string | null
  clock_in: string | null
  clock_out: string | null
  notes: string | null
  clock_in_qr?: string | null
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
  ],
  OPS_SITE_INSPECTION: [
    { id: 'ops_photo_1', name: 'Inspection Photo 1', category: 'OPS_SITE_INSPECTION' },
    { id: 'ops_photo_2', name: 'Inspection Photo 2', category: 'OPS_SITE_INSPECTION' },
    { id: 'ops_photo_3', name: 'Inspection Photo 3', category: 'OPS_SITE_INSPECTION' }
  ]
}

type AreaTaskOverride = {
  tasks: Array<{ name: string; category?: AreaType; description?: string }>
}

const METALEX_ABLUTION_TASKS: AreaTaskOverride['tasks'] = [
  { name: 'Clean toilets', category: 'BATHROOMS_ABLUTIONS' },
  { name: 'Clean sinks', category: 'BATHROOMS_ABLUTIONS' },
  { name: 'Wipe mirrors', category: 'BATHROOMS_ABLUTIONS' },
  { name: 'Empty waste bins', category: 'BATHROOMS_ABLUTIONS' },
  { name: 'Replenish: hand paper towels, toilet rolls, soap', category: 'BATHROOMS_ABLUTIONS' },
  { name: 'Mop floors', category: 'BATHROOMS_ABLUTIONS' },
]

const METALEX_HALL_TASKS: AreaTaskOverride['tasks'] = [
  { name: 'Vacuum, mop or sweep as appropriate', category: 'GENERAL_AREAS' },
  { name: 'Wipe skirting boards', category: 'GENERAL_AREAS' },
  { name: 'Wipe glass panels and internal doors', category: 'GENERAL_AREAS' },
]

const METALEX_OPEN_OFFICE_TASKS: AreaTaskOverride['tasks'] = [
  { name: 'Wipe desks and workstations', category: 'ADMIN_OFFICE' },
  { name: 'Reset meeting rooms (tables, chairs, presentation surfaces)', category: 'ADMIN_OFFICE' },
  { name: 'Vacuum floors', category: 'ADMIN_OFFICE' },
  { name: 'Empty waste bins', category: 'ADMIN_OFFICE' },
  { name: 'Dust computers and monitors', category: 'ADMIN_OFFICE' },
  { name: 'Wipe phones and headsets', category: 'ADMIN_OFFICE' },
  { name: 'Clean light switches and touch points', category: 'ADMIN_OFFICE' },
]

const METALEX_STAIRS_TASKS: AreaTaskOverride['tasks'] = [
  { name: 'Vacuum, mop, or sweep floors (as appropriate)', category: 'GENERAL_AREAS' },
  { name: 'Wipe handrails and banisters', category: 'GENERAL_AREAS' },
]

const METALEX_UNIT11_RECEPTION_TASKS: AreaTaskOverride['tasks'] = [
  { name: 'Clean glass doors and partitions', category: 'RECEPTION_COMMON' },
  { name: 'Clean and arrange waiting area chairs', category: 'RECEPTION_COMMON' },
  { name: 'Wipe windowsills', category: 'RECEPTION_COMMON' },
  { name: 'Vacuum, mop, or sweep floors (as appropriate)', category: 'RECEPTION_COMMON' },
  { name: 'Wipe skirting boards', category: 'RECEPTION_COMMON' },
  { name: 'Wipe glass panels and internal doors', category: 'RECEPTION_COMMON' },
  { name: 'Mop floors', category: 'RECEPTION_COMMON' },
]

const METALEX_UNIT11_REST_AREA_TASKS: AreaTaskOverride['tasks'] = [
  { name: 'Vacuum or mop floors as appropriate', category: 'GENERAL_AREAS' },
  { name: 'Empty waste bins', category: 'GENERAL_AREAS' },
  { name: 'Clean light switches and touch points', category: 'GENERAL_AREAS' },
  { name: 'Wipe down kitchenette', category: 'GENERAL_AREAS' },
]

const CUSTOMER_AREA_TASK_OVERRIDES: Record<string, AreaTaskOverride> = {
  'metalex::hall': {
    tasks: METALEX_HALL_TASKS,
  },
  'metalex::metalex_hall': {
    tasks: METALEX_HALL_TASKS,
  },
  'metalex::ladies_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::ladies': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::metalex_ladies_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::men_s_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::mens_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::metalex_mens_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::open_office': {
    tasks: METALEX_OPEN_OFFICE_TASKS,
  },
  'metalex::metalex_open_office': {
    tasks: METALEX_OPEN_OFFICE_TASKS,
  },
  'metalex::stairs': {
    tasks: METALEX_STAIRS_TASKS,
  },
  'metalex::metalex_stairs': {
    tasks: METALEX_STAIRS_TASKS,
  },
  'metalex::unit_11_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::metalex_unit_11_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::unit_11_disabled_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::metalex_unit_11_disabled_ablution': {
    tasks: METALEX_ABLUTION_TASKS,
  },
  'metalex::unit_11_reception': {
    tasks: METALEX_UNIT11_RECEPTION_TASKS,
  },
  'metalex::unit_11_reception_mop_floors_wipe_ledge': {
    tasks: METALEX_UNIT11_RECEPTION_TASKS,
  },
  'metalex::metalex_unit_11_reception_mop_floors_wipe_ledge': {
    tasks: METALEX_UNIT11_RECEPTION_TASKS,
  },
  'metalex::unit_11_rest_area': {
    tasks: METALEX_UNIT11_REST_AREA_TASKS,
  },
  'metalex::unit_11_rest_area_mop_tidy_wipe_ledge': {
    tasks: METALEX_UNIT11_REST_AREA_TASKS,
  },
  'metalex::metalex_unit_11_rest_area_mop_tidy_wipe_ledge': {
    tasks: METALEX_UNIT11_REST_AREA_TASKS,
  },
  'metalex::metalex_unit_11_rest_area': {
    tasks: METALEX_UNIT11_REST_AREA_TASKS,
  },
}

type AreaTaskRow = {
  id?: string | number | null
  task_description?: string | null
  task_type?: string | null
  qr_code?: string | null
  sort_order?: number | null
  customer_name?: string | null
  area?: string | null
  active?: boolean | null
}

export class QRService {
  private static isSupabaseConfigured() {
    try {
      const url = import.meta.env?.VITE_SUPABASE_URL
      const key = import.meta.env?.VITE_SUPABASE_ANON_KEY
      return Boolean(supabase && typeof url === 'string' && url.trim() && typeof key === 'string' && key.trim())
    } catch {
      return false
    }
  }

  private static hasLocalActiveClockIn(cleanerId?: string | null) {
    if (typeof window === 'undefined') return false
    try {
      const phase = localStorage.getItem('currentClockInPhase')
      if (phase !== 'workflow') return false

      const storedDataRaw = localStorage.getItem('currentClockInData')
      if (!storedDataRaw) return false

      const storedCleanerId = localStorage.getItem('userId')
      if (cleanerId && storedCleanerId && storedCleanerId.trim() && cleanerId.trim()) {
        if (storedCleanerId.trim().toLowerCase() !== cleanerId.trim().toLowerCase()) {
          return false
        }
      }

      return true
    } catch (error) {
      console.warn('Local clock-in state check failed:', error)
      return false
    }
  }

  private static normalizeAreaTypeValue(value?: string | null): AreaType | null {
    if (!value) return null
    const raw = value.toString().trim()
    if (!raw) return null

    const upper = raw.toUpperCase()
    if ((AREA_TASKS as Record<string, TaskDefinition[]>)[upper]) {
      return upper as AreaType
    }

    const canonical = upper.replace(/[^A-Z0-9]+/g, '_')
    if ((AREA_TASKS as Record<string, TaskDefinition[]>)[canonical]) {
      return canonical as AreaType
    }

    return null
  }

  static async fetchTasksForQrArea(qrData: QRCodeData): Promise<TaskDefinition[]> {
    const fallbackAreaType = this.detectAreaType(qrData)
    const normalizedCustomer = (qrData.customerName || qrData.metadata?.siteName || '').trim()
    const normalizedArea = (qrData.metadata?.areaName || '').trim()
    const normalizedAreaSegment = normalizedArea ? this.sanitizeSegment(normalizedArea) : ''
    const overrideKey = this.buildOverrideKey(normalizedCustomer, normalizedArea)
    const overrideTasks = this.getOverrideTasks(
      normalizedCustomer,
      normalizedArea,
      fallbackAreaType,
      overrideKey,
      qrData.areaId,
    )

    if (overrideTasks.length) {
      return overrideTasks
    }

    try {
      if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
        return []
      }

      const rowsById = new Map<string, { task: TaskDefinition; sort: number | null }>()

      const coerceTaskDefinition = (row: AreaTaskRow) => {
        const description = (row.task_description || '').trim()
        if (!description || row.active === false) return

        const sanitizedDescription = this.sanitizeSegment(description)
        const rawTypeValue = (row.task_type || '').toString().trim().toUpperCase()
        const isPlaceholderType = rawTypeValue === 'AREA'
        const matchesAreaLabel = normalizedAreaSegment && sanitizedDescription === normalizedAreaSegment
        if (isPlaceholderType && matchesAreaLabel) {
          return
        }

        const rawId = row.id !== undefined && row.id !== null ? String(row.id) : null
        const defId = rawId || `${qrData.id || 'area'}-${this.sanitizeSegment(description)}-${rowsById.size + 1}`

        if (rowsById.has(defId)) return

        const taskAreaType = this.normalizeAreaTypeValue(row.task_type) ?? fallbackAreaType
        const definition: TaskDefinition = {
          id: defId,
          name: description,
          category: taskAreaType,
          description,
        }

        rowsById.set(defId, {
          task: definition,
          sort: typeof row.sort_order === 'number' ? row.sort_order : null,
        })
      }

      if (qrData.id) {
        const { data } = await supabase
          .from('area_tasks')
          .select('id, task_description, task_type, qr_code, sort_order, active')
          .eq('active', true)
          .eq('qr_code', qrData.id)
          .order('sort_order', { ascending: true, nullsFirst: false })

        data?.forEach((row: AreaTaskRow) => coerceTaskDefinition(row))
      }

      if (!rowsById.size && normalizedCustomer && normalizedArea) {
        const { data } = await supabase
          .from('area_tasks')
          .select('id, task_description, task_type, qr_code, sort_order, active, customer_name, area')
          .eq('active', true)
          .eq('customer_name', normalizedCustomer)
          .eq('area', normalizedArea)
          .order('sort_order', { ascending: true, nullsFirst: false })

        data?.forEach((row: AreaTaskRow) => coerceTaskDefinition(row))
      }

      if (!rowsById.size && normalizedArea) {
        const { data } = await supabase
          .from('area_tasks')
          .select('id, task_description, task_type, qr_code, sort_order, active, customer_name, area')
          .eq('active', true)
          .ilike('area', `%${normalizedArea}%`)
          .order('sort_order', { ascending: true, nullsFirst: false })

        data
          ?.filter((row: AreaTaskRow) => {
            if (!normalizedCustomer) return true
            const label = (row.customer_name || '').trim()
            return label.toLowerCase() === normalizedCustomer.toLowerCase()
          })
          .forEach((row: AreaTaskRow) => coerceTaskDefinition(row))
      }

      if (!rowsById.size) {
        return []
      }

      return Array.from(rowsById.values())
        .sort((a, b) => {
          const aSort = a.sort ?? Number.MAX_SAFE_INTEGER
          const bSort = b.sort ?? Number.MAX_SAFE_INTEGER
          if (aSort !== bSort) return aSort - bSort
          return a.task.name.localeCompare(b.task.name)
        })
        .map(({ task }) => task)
    } catch (error) {
      console.error('Failed to fetch tasks for QR area:', error)
      return overrideTasks
    }
  }

  private static buildOverrideKey(customerName?: string | null, areaName?: string | null) {
    const customerSegment = this.sanitizeSegment(customerName || '')
    const areaSegment = this.sanitizeSegment(areaName || '')
    if (!customerSegment || !areaSegment) {
      return ''
    }
    return `${customerSegment}::${areaSegment}`
  }

  private static getOverrideTasks(
    customerName: string,
    areaName: string,
    fallbackAreaType: AreaType,
    precomputedKey?: string,
    areaId?: string | null,
  ): TaskDefinition[] {
    const customerSegment = this.sanitizeSegment(customerName || '')
    if (!customerSegment) {
      return []
    }

    const candidateKeys: string[] = []
    if (precomputedKey) {
      candidateKeys.push(precomputedKey)
    }

    const candidateSegments = new Set<string>()
    const collectSegment = (value?: string | null) => {
      if (!value) return
      const segment = this.sanitizeSegment(value)
      if (segment) {
        candidateSegments.add(segment)
      }
    }

    collectSegment(areaName)
    collectSegment(areaId)

    if (areaName) {
      const noParens = areaName.replace(/\(.*?\)/g, ' ')
      collectSegment(noParens)

      const replacedDashes = areaName.replace(/[–—−]/g, ' ')
      collectSegment(replacedDashes)
    }

    if (areaId) {
      const withoutPrefix = areaId.replace(/^metalex[_-]*/i, '')
      collectSegment(withoutPrefix)
    }

    for (const segment of candidateSegments) {
      candidateKeys.push(`${customerSegment}::${segment}`)
    }

    const overrideAreaLabel = areaName || areaId || ''

    for (const key of candidateKeys) {
      if (!key) continue
      const override = CUSTOMER_AREA_TASK_OVERRIDES[key]
      if (override) {
        return this.formatOverrideTasks(customerName, overrideAreaLabel, fallbackAreaType, override.tasks)
      }
    }

    if (customerSegment === 'metalex') {
      const heuristicTasks = this.resolveMetalexHeuristic(areaName, areaId)
      if (heuristicTasks.length) {
        return this.formatOverrideTasks(customerName, overrideAreaLabel, fallbackAreaType, heuristicTasks)
      }
    }

    return []
  }

  private static formatOverrideTasks(
    customerName: string,
    areaLabel: string,
    fallbackAreaType: AreaType,
    tasks: AreaTaskOverride['tasks'],
  ): TaskDefinition[] {
    if (!tasks.length) {
      return []
    }

    const customerSegment = this.sanitizeSegment(customerName || 'customer')
    const areaSegment = this.sanitizeSegment(areaLabel || 'area')

    return tasks.map((task, index) => ({
      id: `${customerSegment}_${areaSegment}_${this.sanitizeSegment(task.name)}_${index}`,
      name: task.name,
      category: task.category ?? fallbackAreaType,
      description: task.description ?? task.name,
    }))
  }

  private static resolveMetalexHeuristic(
    areaName?: string | null,
    areaId?: string | null,
  ): AreaTaskOverride['tasks'] {
    const searchSource = `${areaName || ''} ${areaId || ''}`.toLowerCase()
    const condensed = searchSource.replace(/[^a-z0-9]+/g, ' ')
    if (!condensed.trim()) {
      return []
    }

    const contains = (pattern: RegExp) => pattern.test(condensed)

    if (contains(/ablution/)) {
      return METALEX_ABLUTION_TASKS
    }

    if (contains(/unit\s*11/) && contains(/reception/)) {
      return METALEX_UNIT11_RECEPTION_TASKS
    }

    if (contains(/rest\s*area/) && contains(/unit\s*11/)) {
      return METALEX_UNIT11_REST_AREA_TASKS
    }

    if (contains(/open\s*office/)) {
      return METALEX_OPEN_OFFICE_TASKS
    }

    if (contains(/stairs?/)) {
      return METALEX_STAIRS_TASKS
    }

    if (contains(/hall/)) {
      return METALEX_HALL_TASKS
    }

    return []
  }

  static getPresetTasks(
    customerName: string,
    areaName: string,
    areaId?: string | null,
  ): TaskDefinition[] {
    const dummyQr: QRCodeData = {
      id: areaId || '',
      type: 'AREA',
      customerName,
      metadata: { areaName },
    }
    const fallbackAreaType = this.detectAreaType(dummyQr)
    const overrideKey = this.buildOverrideKey(customerName, areaName)
    return this.getOverrideTasks(customerName, areaName, fallbackAreaType, overrideKey, areaId)
  }

  private static normalizeLabel(value?: string | null) {
    if (!value) return ''
    const trimmed = value.toString().trim()
    if (!trimmed || /unknown site/i.test(trimmed)) return ''
    return trimmed
  }

  static normalizeQrType(type?: string | null): QRCodeData['type'] | null {
    if (!type) return null
    const normalized = type.toString().trim()
    if (!normalized) return null

    const canonical = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')

    switch (canonical) {
      case 'clock_in':
      case 'clockin':
        return 'CLOCK_IN'
      case 'clock_out':
      case 'clockout':
        return 'CLOCK_OUT'
      case 'area':
        return 'AREA'
      case 'task':
        return 'TASK'
      case 'feedback':
        return 'FEEDBACK'
      default:
        return null
    }
  }

  private static resolveClockInReference(qrData: QRCodeData): string | null {
    const metadata = qrData.metadata || {}
    const candidateKeys = [
      'clockInQrId',
      'clock_in_qr_id',
      'clockInQr',
      'clock_in_qr',
      'clockInId',
      'clock_in_id',
      'linkedClockInQrId',
      'linked_clock_in_qr_id',
      'pairedClockInId',
      'paired_clock_in_id',
      'pairedClockInQr',
      'paired_clock_in_qr',
      'clockInCode',
      'clock_in_code',
    ]

    for (const key of candidateKeys) {
      const value = (metadata as Record<string, any>)[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    const nestedClockIn = (metadata as Record<string, any>).clockIn
    if (nestedClockIn && typeof nestedClockIn === 'object') {
      const nestedValue = nestedClockIn.id || nestedClockIn.qrId || nestedClockIn.qr_id
      if (typeof nestedValue === 'string' && nestedValue.trim()) {
        return nestedValue.trim()
      }
    }

    return null
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
    const normalizedType = this.normalizeQrType(type) ?? 'AREA'
    switch (normalizedType) {
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

    if (!payload.customerId?.trim()) {
      throw new Error('Customer selection is required')
    }

    const normalizedType = this.normalizeQrType(payload.type) ?? 'AREA'
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
      type: normalizedType,
      siteId: payload.siteId?.trim() || undefined,
      areaId: payload.areaId?.trim() || undefined,
      taskId: normalizedType === 'TASK' ? payload.metadata?.taskId || uuidv4() : undefined,
      customerName: trimmedCustomer,
      metadata,
    }

    const qrValue = payload.rawValue || JSON.stringify(qrData)

    const dataUrl = await this.generateQRCode(qrValue)

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
        }, { onConflict: 'customer_name,building_area' })

      if (insertError) {
        throw insertError
      }

      await this.ensureAreaTaskRecord(
        qrData,
        trimmedCustomer,
        metadata.areaName || metadata.siteName || payload.type,
        payload.description,
      )

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
  static async generateQRCode(data: QRCodeData | string): Promise<string> {
    try {
      const qrValue = typeof data === 'string' ? data : JSON.stringify(data)
      const qrCodeDataURL = await QRCode.toDataURL(qrValue, {
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

      if (typeof data === 'object' && data) {
        const record = data as Record<string, any>

        if (!record.id && typeof record.metadata?.qrCodeId === 'string') {
          record.id = record.metadata.qrCodeId
        }

        const normalizedType =
          this.normalizeQrType(record.type) ||
          this.normalizeQrType(record.metadata?.action) ||
          this.normalizeQrType(record.metadata?.qrType)

        if (normalizedType) {
          record.type = normalizedType
        }

        if (record.id && record.type) {
          return record as QRCodeData
        }
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
      const normalizedType = this.normalizeQrType(qrData.type) ?? 'AREA'
      const clockInReference = this.resolveClockInReference(qrData)
      const localClockedIn = this.hasLocalActiveClockIn(cleanerId)
      // Database should be configured now

      switch (normalizedType) {
        case 'CLOCK_IN':
          action = 'Clock In'
          siteArea = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
          
          // Check if already clocked in
          const alreadyClockedIn = await this.isAlreadyClockedIn(cleanerId, { clockInQr: qrData.id })
          if (alreadyClockedIn) {
            return { 
              success: false, 
              message: 'You are already clocked in. Please clock out first or scan an area QR code to continue working.' 
            }
          }
          
          const clockInResult = await this.logClockEvent(cleanerId, qrData.siteId ?? '', 'clock_in', qrData.id, qrData)
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
          
          const alreadyClockedOut = await this.isAlreadyClockedOut(cleanerId, {
            clockInQr: clockInReference ?? null,
          })
          console.log('Already clocked out?', alreadyClockedOut)
          
          if (alreadyClockedOut && !localClockedIn) {
            return { 
              success: false, 
              message: `You are already clocked out, ${cleanerName}. Please scan a Clock In QR code to start working.` 
            }
          }
          
          const clockOutResult = await this.logClockEvent(
            cleanerId,
            qrData.siteId ?? '',
            'clock_out',
            qrData.id,
            qrData,
            clockInReference ?? null,
          )
          if (!clockOutResult.success) {
            return { success: false, message: clockOutResult.message }
          }
          break
          
        case 'AREA':
          action = 'Area Scan'
          siteArea = this.prettifySiteLabel(qrData.metadata?.areaName) || siteLabel
          
          // Check if clocked in before allowing area scan
          const isClockedIn = await this.isAlreadyClockedIn(cleanerId)
          if (!isClockedIn && !localClockedIn) {
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
    qrData: QRCodeData,
    clockInReference?: string | null,
  ): Promise<{success: boolean, message?: string}> {
    try {
      if (!this.isSupabaseConfigured()) {
        console.warn('Supabase not configured; skipping remote log for', eventType)
        return { success: true }
      }
      const rawCleanerName = getStoredCleanerName()
      const cleanerName = normalizeCleanerName(rawCleanerName)
      const currentTime = new Date().toISOString()
      const siteLabelRaw = this.deriveSiteLabel(qrData, siteId)
      const siteLabel = this.prettifySiteLabel(siteLabelRaw) || siteLabelRaw || 'Site'
      const customerLabel = this.deriveCustomerLabel(qrData, siteLabel)
      const trimmedCleanerId = cleanerId ? cleanerId.toString().trim() : null
      const numericCleanerId = trimmedCleanerId ? normalizeCleanerNumericId(trimmedCleanerId) : null

      if (eventType === 'clock_in') {
        // For clock-in, create a new time_attendance record
          const { error: attendanceError } = await supabase
          .from('time_attendance')
          .insert({
            cleaner_id: numericCleanerId,
            cleaner_uuid: trimmedCleanerId,
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
        const openRecord = await this.findOpenAttendanceRecord(cleanerId, cleanerName, {
          clockInQr: clockInReference || this.resolveClockInReference(qrData) || null,
        })

        if (!openRecord) {
          console.error('No active attendance record found for clock-out')
          return { success: false, message: 'No active clock-in found. Please clock in first.' }
        }

        const updatePayload: Record<string, any> = {
          clock_out: currentTime,
          notes: openRecord.notes ? `${openRecord.notes} | Clock-out via QR` : 'Clock-out via QR',
          customer_name: customerLabel || openRecord.customer_name,
          site_name: siteLabel || openRecord.site_name,
        }

        if ((openRecord.cleaner_uuid === null || openRecord.cleaner_uuid === undefined) && trimmedCleanerId) {
          updatePayload.cleaner_uuid = trimmedCleanerId
        }

        if ((openRecord.cleaner_id === null || openRecord.cleaner_id === undefined) && numericCleanerId !== null) {
          updatePayload.cleaner_id = numericCleanerId
        }

        const { error: updateError } = await supabase
          .from('time_attendance')
          .update(updatePayload)
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

  private static async findOpenAttendanceRecord(
    cleanerId: string | null | undefined,
    cleanerName: string,
    options?: { clockInQr?: string | null; allowFuzzy?: boolean },
  ): Promise<TimeAttendanceRecord | null> {
    try {
      if (!this.isSupabaseConfigured()) {
        return null
      }
      if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
        console.error('Supabase not configured properly')
        return null
      }

      const trimmedCleanerId = cleanerId ? cleanerId.toString().trim() : null
      const numericCleanerId = trimmedCleanerId ? normalizeCleanerNumericId(trimmedCleanerId) : null
      const normalizedCleanerName = normalizeCleanerName(cleanerName)
      const normalizedCleanerNameLower = normalizedCleanerName.toLowerCase()
      const clockInQr = options?.clockInQr ? options.clockInQr.toString().trim() : null

      let cleanerMobile: string | null = null
      try {
        cleanerMobile = typeof window !== 'undefined' ? localStorage.getItem('userMobile') : null
      } catch {
        cleanerMobile = null
      }

      const selectColumns =
        'id, cleaner_id, cleaner_uuid, cleaner_name, cleaner_mobile, customer_name, site_name, clock_in, clock_out, notes, clock_in_qr'

      const matchesRecord = (candidate?: Partial<TimeAttendanceRecord> | null) => {
        if (!candidate) return false

        if (clockInQr && candidate.clock_in_qr && candidate.clock_in_qr === clockInQr) {
          return true
        }

        if (trimmedCleanerId && candidate.cleaner_uuid) {
          if (candidate.cleaner_uuid.trim().toLowerCase() === trimmedCleanerId.toLowerCase()) {
            return true
          }
        }

        if (
          numericCleanerId !== null &&
          candidate.cleaner_id !== null &&
          candidate.cleaner_id !== undefined &&
          Number(candidate.cleaner_id) === numericCleanerId
        ) {
          return true
        }

        if (cleanerMobile && candidate.cleaner_mobile) {
          if (candidate.cleaner_mobile.trim() === cleanerMobile.trim()) {
            return true
          }
        }

        if (normalizedCleanerName && candidate.cleaner_name) {
          const candidateName = normalizeCleanerName(candidate.cleaner_name).toLowerCase()
          if (candidateName === normalizedCleanerNameLower) {
            return true
          }
        }

        return false
      }

      const queryFactories: Array<() => Promise<{ data: TimeAttendanceRecord[] | null; error: any }>> = []

      if (numericCleanerId !== null) {
        queryFactories.push(() =>
          supabase
            .from('time_attendance')
            .select(selectColumns)
            .eq('cleaner_id', numericCleanerId)
            .is('clock_out', null)
            .order('id', { ascending: false })
            .limit(3),
        )
      }

      if (trimmedCleanerId && isUuid(trimmedCleanerId)) {
        queryFactories.push(() =>
          supabase
            .from('time_attendance')
            .select(selectColumns)
            .eq('cleaner_uuid', trimmedCleanerId)
            .is('clock_out', null)
            .order('id', { ascending: false })
            .limit(3),
        )
      }

      if (normalizedCleanerName) {
        queryFactories.push(() =>
          supabase
            .from('time_attendance')
            .select(selectColumns)
            .eq('cleaner_name', normalizedCleanerName)
            .is('clock_out', null)
            .order('id', { ascending: false })
            .limit(3),
        )
      }

      if (cleanerMobile) {
        queryFactories.push(() =>
          supabase
            .from('time_attendance')
            .select(selectColumns)
            .eq('cleaner_mobile', cleanerMobile)
            .is('clock_out', null)
            .order('id', { ascending: false })
            .limit(3),
        )
      }

      const allowFuzzy = options?.allowFuzzy ?? true
      if (allowFuzzy && normalizedCleanerName && normalizedCleanerName !== 'Unknown Cleaner') {
        queryFactories.push(() =>
          supabase
            .from('time_attendance')
            .select(selectColumns)
            .ilike('cleaner_name', `%${normalizedCleanerName}%`)
            .is('clock_out', null)
            .order('id', { ascending: false })
            .limit(5),
        )
      }

      if (clockInQr) {
        queryFactories.push(() =>
          supabase
            .from('time_attendance')
            .select(selectColumns)
            .eq('clock_in_qr', clockInQr)
            .is('clock_out', null)
            .order('id', { ascending: false })
            .limit(5),
        )
      }

      for (const buildQuery of queryFactories) {
        const { data, error } = await buildQuery()
        if (error) {
          console.error('Error finding open attendance record candidate:', error)
          continue
        }

        const rows = data ?? []
        const match = rows.find((row) => matchesRecord(row))
        if (match) {
          return match as TimeAttendanceRecord
        }
      }

      return null
    } catch (error) {
      console.error('Error in findOpenAttendanceRecord:', error)
      return null
    }
  }

  /**
   * Check if cleaner is already clocked in
   */
  private static async isAlreadyClockedIn(
    cleanerId: string,
    options?: { clockInQr?: string | null },
  ): Promise<boolean> {
    try {
      const localActive = this.hasLocalActiveClockIn(cleanerId)
      if (!this.isSupabaseConfigured()) {
        return localActive
      }
      // Check if Supabase is configured
      if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
        console.error('Supabase not configured properly')
        return localActive
      }

      const cleanerName = getStoredCleanerName()
      console.log('Checking if clocked in for:', cleanerName)

      const openRecord = await this.findOpenAttendanceRecord(cleanerId, cleanerName, {
        clockInQr: options?.clockInQr ?? null,
      })

      const isOpen = Boolean(openRecord)
      console.log('Has open clock-in sessions?', isOpen)
      if (isOpen && openRecord) {
        console.log('Latest open session:', openRecord)
      }

      if (!isOpen && localActive) {
        console.warn('Supabase did not return an active clock-in, but local state indicates an active session. Trusting local state.')
        return true
      }

      return isOpen
    } catch (error) {
      console.error('Error in isAlreadyClockedIn:', error)
      // If any error, allow operation to continue
      return this.hasLocalActiveClockIn(cleanerId)
    }
  }

  /**
   * Check if cleaner is already clocked out
   */
  private static async isAlreadyClockedOut(
    cleanerId: string,
    options?: { clockInQr?: string | null },
  ): Promise<boolean> {
    try {
      const localActive = this.hasLocalActiveClockIn(cleanerId)
      if (!this.isSupabaseConfigured()) {
        return !localActive
      }
      // Check if Supabase is configured
      if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
        console.error('Supabase not configured properly')
        return !localActive
      }

      const cleanerName = getStoredCleanerName()
      console.log('Checking clock-out status for:', cleanerName)

      // If there's no active clock-in, consider them clocked out
      const isActive = await this.isAlreadyClockedIn(cleanerId, options)
      console.log('Is currently clocked in?', isActive)
      
      const result = !isActive
      if (result && localActive) {
        console.warn('Supabase indicated no active clock-in, but local state shows active session. Treating as still clocked in.')
        return false
      }
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

  static async saveOpsInspection(payload: OpsInspectionPayload): Promise<boolean> {
    try {
      if (!payload.cleanerId) {
        throw new Error('Cleaner ID is required to save an inspection.')
      }

      const photos = Array.isArray(payload.photos) ? [...payload.photos] : []
      if (!photos.length) {
        throw new Error('At least one photo is required to submit an inspection.')
      }

      const sortedPhotos = photos
        .filter((photo) => photo && typeof photo.photo === 'string' && photo.photo.trim().length > 0)
        .sort((a, b) => a.slot - b.slot)

      if (!sortedPhotos.length) {
        throw new Error('Inspection photos are not valid.')
      }

      const cleanerName = getStoredCleanerName()
      const qrCodeId = (payload.qrCodeId || '').trim() || `ops_inspection_${uuidv4()}`
      const submissionTimestamp = new Date().toISOString()
      const taskIds = sortedPhotos.map((photo) => `ops_photo_${photo.slot}`)

      // Persist summary selection for analytics (best-effort)
      const { error: selectionError } = await supabase
        .from('uk_cleaner_task_selections')
        .insert({
          cleaner_id: payload.cleanerId,
          cleaner_name: cleanerName,
          qr_code_id: qrCodeId,
          area_type: 'OPS_SITE_INSPECTION',
          selected_tasks: JSON.stringify(taskIds),
          completed_tasks: JSON.stringify(taskIds),
          timestamp: submissionTimestamp,
        })

      if (selectionError) {
        console.warn('Ops inspection selection insert failed (continuing with photos):', selectionError)
      }

      const siteLabel = payload.siteName?.trim() || 'Site Inspection'
      const customerLabel = payload.customerName?.trim() || payload.siteName?.trim() || null
      const startedAt = payload.clockInTime || submissionTimestamp

      const photoRows = sortedPhotos.map((photo) => ({
        cleaner_id: payload.cleanerId,
        cleaner_name: cleanerName,
        qr_code_id: qrCodeId,
        task_id: `ops_photo_${photo.slot}`,
        area_type: 'OPS_SITE_INSPECTION',
        area_name: siteLabel,
        customer_name: customerLabel,
        photo_data: photo.photo,
        photo_timestamp: photo.timestamp,
        started_at: startedAt,
      }))

      const { error: photoError } = await supabase
        .from('uk_cleaner_task_photos')
        .insert(photoRows)

      if (photoError) {
        console.error('Failed to save ops inspection photos:', photoError)
        return false
      }

      return true
    } catch (error) {
      console.error('Error saving ops inspection:', error)
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
