import { supabase, type Cleaner } from './supabase'

const CLEANER_SUMMARY_FIELDS = 'id, first_name, last_name, created_at, email, mobile_number, is_active' as const

export type CleanerSummary = Pick<
  Cleaner,
  'id' | 'first_name' | 'last_name' | 'created_at' | 'email' | 'mobile_number' | 'is_active'
>

export async function fetchManagerCleanerIds(managerId: string): Promise<string[]> {
  if (!managerId) {
    return []
  }

  const { data, error } = await supabase
    .from('manager_cleaners')
    .select('cleaner_id')
    .eq('manager_id', managerId)

  if (error) {
    console.error('Failed to load manager_cleaners mapping', error)
    throw error
  }

  return (data ?? [])
    .map((row) => row.cleaner_id)
    .filter((cleanerId): cleanerId is string => Boolean(cleanerId))
}

export async function fetchCleanersByIds(cleanerIds: string[]): Promise<CleanerSummary[]> {
  if (!cleanerIds.length) {
    return []
  }

  const { data, error } = await supabase
    .from('cleaners')
    .select(CLEANER_SUMMARY_FIELDS)
    .in('id', cleanerIds)

  if (error) {
    console.error('Failed to fetch cleaners by IDs', error)
    throw error
  }

  return (data ?? []) as CleanerSummary[]
}

export async function fetchAllCleaners(): Promise<CleanerSummary[]> {
  const { data, error } = await supabase
    .from('cleaners')
    .select(CLEANER_SUMMARY_FIELDS)
    .order('first_name', { ascending: true })

  if (error) {
    console.error('Failed to fetch all cleaners', error)
    throw error
  }

  return (data ?? []) as CleanerSummary[]
}

export async function resolveManagerCleanerRoster(managerId?: string | null): Promise<CleanerSummary[]> {
  const scopedManagerId = managerId ?? ''

  if (!scopedManagerId) {
    return fetchAllCleaners()
  }

  try {
    const cleanerIds = await fetchManagerCleanerIds(scopedManagerId)
    if (!cleanerIds.length) {
      return fetchAllCleaners()
    }
    return fetchCleanersByIds(cleanerIds)
  } catch (error) {
    console.warn('Falling back to full cleaner roster', error)
    return fetchAllCleaners()
  }
}

export type ManagerActivityRow = {
  id: string
  cleaner_id: string | null
  cleaner_name: string | null
  action: string
  timestamp: string | null
  detail: string | null
  site?: string | null
  area?: string | null
  comments?: string | null
  photo_url?: string | null
  entry_type: 'log' | 'photo'
}

const RESERVED_ACTIVITY_LABELS = new Set([
  'bathrooms ablutions',
  'admin office',
  'general areas',
  'warehouse industrial',
  'kitchen canteen',
  'reception common',
  'unassigned area',
  'unknown area',
  'area',
])

const normalizeActivityLabel = (value?: string | null) => {
  if (!value) return null
  const trimmed = value.toString().trim()
  if (!trimmed) return null
  if (/^[A-Z0-9_]+$/.test(trimmed) && trimmed.includes('_')) {
    return null
  }
  const cleaned = trimmed.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!cleaned) return null
  if (RESERVED_ACTIVITY_LABELS.has(cleaned.toLowerCase())) {
    return null
  }
  return cleaned
}

const resolveActivityDisplayLabel = (
  ...labels: Array<string | null | undefined>
) => {
  for (const label of labels) {
    const normalized = normalizeActivityLabel(label)
    if (normalized) {
      return normalized
    }
  }
  return null
}

export async function fetchManagerRecentActivity(
  managerId: string,
  limit = 100,
): Promise<ManagerActivityRow[]> {
  let cleanerIds: string[] = []

  try {
    cleanerIds = await fetchManagerCleanerIds(managerId)
  } catch (error) {
    console.warn('Falling back to global cleaner activity feed', error)
  }

  let logsQuery = supabase
    .from('cleaner_logs')
    .select('id, cleaner_id, action, comments, timestamp, site_id, area_id, qr_code_id, customer_name, site_area')

  if (cleanerIds.length) {
    logsQuery = logsQuery.in('cleaner_id', cleanerIds)
  }

  const [{ data: logRows, error: logError }] = await Promise.all([
    logsQuery.order('timestamp', { ascending: false }).limit(limit),
  ])

  if (logError) {
    console.error('Failed to load cleaner logs for manager activity', logError)
    throw logError
  }

  let photosQuery = supabase
    .from('uk_cleaner_task_photos')
    .select('id, cleaner_id, cleaner_name, area_type, qr_code_id, task_id, photo_data, photo_timestamp, created_at, customer_name, site_area, area_name')

  if (cleanerIds.length) {
    photosQuery = photosQuery.in('cleaner_id', cleanerIds)
  }

  const { data: photoRows, error: photoError } = await photosQuery
    .order('photo_timestamp', { ascending: false, nullsFirst: true })
    .limit(limit)

  if (photoError) {
    console.warn('Failed to load task photos for manager activity', photoError)
  }

  const cleanerIdsForNames = Array.from(
    new Set([
      ...(cleanerIds ?? []),
      ...((logRows ?? []).map((row) => row.cleaner_id).filter(Boolean) as string[]),
      ...((photoRows ?? []).map((row) => row.cleaner_id).filter(Boolean) as string[]),
    ])
  )

  const qrCodeIds = Array.from(
    new Set(
      [
        ...((logRows ?? []).map((row) => row.qr_code_id).filter(Boolean) as string[]),
        ...((photoRows ?? []).map((row) => row.qr_code_id).filter(Boolean) as string[]),
      ],
    ),
  )

  const siteIds = Array.from(
    new Set((logRows ?? []).map((row) => row.site_id ?? null).filter((value): value is string => Boolean(value)))
  )

  const areaIds = Array.from(
    new Set((logRows ?? []).map((row) => row.area_id ?? null).filter((value): value is string => Boolean(value)))
  )

  let cleanerNameMap = new Map<string, string>()

  if (cleanerIdsForNames.length) {
    try {
      const cleanerRecords = await fetchCleanersByIds(cleanerIdsForNames)
      cleanerNameMap = new Map(
        cleanerRecords.map((cleaner) => [
          cleaner.id,
          `${cleaner.first_name ?? ''} ${cleaner.last_name ?? ''}`.trim() || 'Cleaner',
        ])
      )
    } catch (error) {
      console.warn('Unable to fetch cleaner names for manager activity', error)
    }
  }

  const siteMap = new Map<string, string>()
  if (siteIds.length) {
    const { data: siteRows, error: siteError } = await supabase
      .from('sites')
      .select('id, name')
      .in('id', siteIds)

    if (siteError) {
      console.warn('Failed to load site names for manager activity', siteError)
    } else {
      ;(siteRows ?? []).forEach((site) => {
        if (site.id) {
          siteMap.set(site.id, site.name ?? 'Site')
        }
      })
    }
  }

  const areaMap = new Map<string, string>()
  if (areaIds.length) {
    const { data: areaRows, error: areaError } = await supabase
      .from('areas')
      .select('id, name, description')
      .in('id', areaIds)

    if (areaError) {
      console.warn('Failed to load area names for manager activity', areaError)
    } else {
      ;(areaRows ?? []).forEach((area) => {
        if (area.id) {
          const label = area.name || area.description || 'Area'
          areaMap.set(area.id, label)
        }
      })
    }
  }

  type QRMetadata = {
    area: string | null
    customer: string | null
  }

  const qrMetadataMap = new Map<string, QRMetadata>()

  if (qrCodeIds.length) {
    const { data: qrRows, error: qrError } = await supabase
      .from('building_qr_codes')
      .select('qr_code_id, building_area, customer_name, area_description')
      .in('qr_code_id', qrCodeIds)

    if (qrError) {
      console.warn('Failed to load QR metadata for manager activity', qrError)
    } else {
      ;(qrRows ?? []).forEach((row) => {
        if (!row?.qr_code_id) return
        const areaLabel = row.building_area?.trim() || row.area_description?.trim() || null
        const customerLabel = row.customer_name?.trim() || null
        qrMetadataMap.set(row.qr_code_id, {
          area: areaLabel,
          customer: customerLabel,
        })
      })
    }
  }

  const entries: ManagerActivityRow[] = []

  ;(logRows ?? []).forEach((row) => {
    const cleanerId = row.cleaner_id ?? null
    const nameFromMap = cleanerId ? cleanerNameMap.get(cleanerId) ?? null : null
    const qrMeta = row.qr_code_id ? qrMetadataMap.get(row.qr_code_id) : undefined
    const siteLabel = resolveActivityDisplayLabel(qrMeta?.customer, row.customer_name, row.site_id ? siteMap.get(row.site_id) ?? null : null)
    const areaLabel = resolveActivityDisplayLabel(qrMeta?.area, row.area_id ? areaMap.get(row.area_id) ?? null : null, row.site_area)
    const detailParts: string[] = []
    if (siteLabel) detailParts.push(siteLabel)
    if (areaLabel) detailParts.push(areaLabel)
    if (row.comments) detailParts.push(row.comments)

    entries.push({
      id: `log-${row.id}`,
      cleaner_id: cleanerId,
      cleaner_name: nameFromMap,
      action: row.action ?? 'Activity Logged',
      timestamp: row.timestamp ?? null,
      detail: detailParts.join(' • ') || null,
      site: siteLabel,
      area: areaLabel,
      comments: row.comments ?? null,
      photo_url: null,
      entry_type: 'log',
    })
  })

  ;(photoRows ?? []).forEach((row) => {
    const cleanerId = row.cleaner_id ?? null
    const nameFromMap = cleanerId ? cleanerNameMap.get(cleanerId) ?? row.cleaner_name ?? null : row.cleaner_name ?? null
    const photoSource = row.photo_data ?? null
    const timestamp = row.photo_timestamp ?? row.created_at ?? null
    const qrMeta = row.qr_code_id ? qrMetadataMap.get(row.qr_code_id) : undefined
    const resolvedSite = resolveActivityDisplayLabel(qrMeta?.customer, row.customer_name, row.site_area)
    const detailArea = resolveActivityDisplayLabel(qrMeta?.area, row.area_name, row.area_type)
    const detailParts: string[] = []
    if (detailArea) detailParts.push(detailArea)
    if (row.qr_code_id) detailParts.push(row.qr_code_id)
    if (row.task_id) detailParts.push(row.task_id)
    const detail = detailParts.join(' • ') || 'Task photo'

    entries.push({
      id: `photo-${row.id}`,
      cleaner_id: cleanerId,
      cleaner_name: nameFromMap,
      action: 'Task Photo Submitted',
      timestamp,
      detail,
      area: detailArea,
      site: resolvedSite,
      photo_url: photoSource,
      entry_type: 'photo',
    })
  })

  const sorted = entries.sort((a, b) => {
    const aTime = a.timestamp ? new Date(a.timestamp).getTime() : Number.NEGATIVE_INFINITY
    const bTime = b.timestamp ? new Date(b.timestamp).getTime() : Number.NEGATIVE_INFINITY
    return bTime - aTime
  })

  return sorted.slice(0, limit)
}

