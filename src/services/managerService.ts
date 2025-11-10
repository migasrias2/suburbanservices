import { normalizeCleanerName, normalizeCleanerNumericId } from '../lib/identity'
import { supabase, type Cleaner } from './supabase'

type ManagerRole = 'manager' | 'ops_manager' | 'admin'

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

type DeleteCleanerOptions = {
  cleanerId: string
  cleanerName?: string | null
}

type DeleteCleanerSummary = Record<string, number>

export async function deleteCleaner({ cleanerId, cleanerName }: DeleteCleanerOptions): Promise<{
  summary: DeleteCleanerSummary
}> {
  const trimmedId = typeof cleanerId === 'string' ? cleanerId.trim() : ''

  if (!trimmedId) {
    throw new Error('Cleaner ID is required to delete a cleaner record')
  }

  const normalizedCleanerName = cleanerName ? normalizeCleanerName(cleanerName) : null

  const { data, error } = await supabase.rpc('manager_delete_cleaner', {
    p_cleaner_identifier: trimmedId,
    p_cleaner_name: normalizedCleanerName ?? null,
  })

  if (error) {
    console.error('manager_delete_cleaner RPC failed', error)
    throw error
  }

  const summary: DeleteCleanerSummary = {}

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === 'number') {
        summary[key] = value
      } else if (typeof value === 'string') {
        const parsed = Number(value)
        if (!Number.isNaN(parsed)) {
          summary[key] = parsed
        }
      }
    }
  }

  return { summary }
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
  entry_type: 'attendance' | 'task' | 'photo'
  total_task_count?: number | null
  completed_task_count?: number | null
  photo_count?: number | null
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
  'unknown site',
  'area',
  'site',
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

const ACTIVITY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000

const parseTaskList = (value?: string | null): string[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch (error) {
    console.warn('Failed to parse task list for recent activity', error)
  }
  return []
}

const toTimestamp = (value?: string | null): number => {
  if (!value) return Number.NEGATIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

const resolveCleanerKey = (id?: string | number | null, fallbackName?: string | null): string | null => {
  if (id !== null && id !== undefined) {
    const trimmed = String(id).trim()
    if (trimmed) return trimmed
  }
  const normalizedName = normalizeCleanerName(fallbackName)
  if (normalizedName && normalizedName !== 'Unknown Cleaner') {
    return normalizedName.toLowerCase()
  }
  return null
}

const resolveAssociationKey = (
  cleanerId?: string | number | null,
  cleanerName?: string | null,
  qrCodeId?: string | null,
): string | null => {
  const cleanerKey = resolveCleanerKey(cleanerId, cleanerName)
  if (!cleanerKey) return null
  const qrKey = qrCodeId ? qrCodeId.trim() : ''
  return `${cleanerKey}::${qrKey || 'unknown'}`
}

const deriveLocationFromQrId = (qrCodeId?: string | null): { site: string | null; area: string | null } | null => {
  if (!qrCodeId) return null
  const trimmed = qrCodeId.trim()
  if (!trimmed) return null

  const parts = trimmed
    .split('-')
    .map((part) => normalizeActivityLabel(part))
    .filter((part): part is string => Boolean(part))

  if (!parts.length) {
    const fallback = normalizeActivityLabel(trimmed)
    return fallback ? { site: fallback, area: null } : null
  }

  const [sitePart, ...areaParts] = parts
  const site = sitePart || null
  const area = areaParts.length ? areaParts.join(' • ') : null

  return { site, area }
}

export async function fetchManagerRecentActivity(
  managerId: string | null | undefined,
  limit = 100,
  role: ManagerRole = 'manager',
): Promise<ManagerActivityRow[]> {
  const isGlobalRole = role === 'admin' || role === 'ops_manager'
  let scopedCleanerIds: string[] = []

  if (managerId) {
    try {
      scopedCleanerIds = await fetchManagerCleanerIds(managerId)
    } catch (error) {
      console.warn('Falling back to global cleaner activity feed', error)
      scopedCleanerIds = []
    }
  }

  const trimmedCleanerIds = scopedCleanerIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
  const restrictToManagedCleaners = !isGlobalRole && trimmedCleanerIds.length > 0

  type CleanerIdentifier = {
    raw: string
    normalized: string
    numeric: number | null
  }

  const normalizedCleanerIdentifiers: CleanerIdentifier[] = trimmedCleanerIds.map((value) => ({
    raw: value.trim(),
    normalized: normalizeCleanerName(value).toLowerCase(),
    numeric: normalizeCleanerNumericId(value),
  }))

  const cleanerIdSet = new Set(normalizedCleanerIdentifiers.map((identifier) => identifier.raw))
  const numericCleanerIdSet = new Set(
    normalizedCleanerIdentifiers.map((identifier) => identifier.numeric).filter((value): value is number => value !== null),
  )
  const rosterNameSet = new Set<string>()
  const cleanerNameMap = new Map<string, string>()

  const registerRosterName = (value?: string | null) => {
    if (!value) return
    const normalized = normalizeCleanerName(value)
    if (!normalized || normalized === 'Unknown Cleaner') return
    rosterNameSet.add(normalized.toLowerCase())
  }

  const registerCleanerName = (id: string | null | undefined, value?: string | null) => {
    if (!id) return
    const trimmedId = String(id).trim()
    if (!trimmedId) return
    const normalized = normalizeCleanerName(value)
    if (normalized && normalized !== 'Unknown Cleaner') {
      cleanerNameMap.set(trimmedId, normalized)
      rosterNameSet.add(normalized.toLowerCase())
    } else if (!cleanerNameMap.has(trimmedId)) {
      cleanerNameMap.set(trimmedId, 'Cleaner')
    }
  }

  normalizedCleanerIdentifiers.forEach((identifier) => {
    if (identifier.normalized) {
      rosterNameSet.add(identifier.normalized)
    }
  })

  if (trimmedCleanerIds.length) {
    try {
      const rosterRecords = await fetchCleanersByIds(trimmedCleanerIds)
      rosterRecords.forEach((record) => {
        const displayName = `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim()
        registerCleanerName(record.id, displayName)
      })
    } catch (error) {
      console.warn('Failed to preload roster names for manager activity scope', error)
    }
  }

  type ScopedCleanerRow = {
    cleaner_id?: string | number | null
    cleaner_uuid?: string | null
    cleaner_name?: string | null
  }

  const matchesCleanerScope = (row: ScopedCleanerRow): boolean => {
    if (!restrictToManagedCleaners) {
      return true
    }

    const candidateIds: string[] = []

    if (row.cleaner_id !== null && row.cleaner_id !== undefined) {
      candidateIds.push(String(row.cleaner_id).trim())
    }
    if (row.cleaner_uuid) {
      candidateIds.push(row.cleaner_uuid.trim())
    }

    for (const candidate of candidateIds) {
      if (!candidate) continue
      if (cleanerIdSet.has(candidate)) return true
      const numericCandidate = normalizeCleanerNumericId(candidate)
      if (numericCandidate !== null && numericCleanerIdSet.has(numericCandidate)) {
        return true
      }
    }

    if (row.cleaner_name) {
      const normalizedName = normalizeCleanerName(row.cleaner_name).toLowerCase()
      if (rosterNameSet.has(normalizedName)) {
        return true
      }
    }

    return false
  }

  const windowStartIso = new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString()

  let selectionsBuilder = supabase
    .from('uk_cleaner_task_selections')
    .select(
      'id, cleaner_id, cleaner_name, qr_code_id, area_type, selected_tasks, completed_tasks, timestamp',
    )
    .order('timestamp', { ascending: false })
    .limit(limit * 2)

  selectionsBuilder = selectionsBuilder.gte('timestamp', windowStartIso)

  let photosBuilder = supabase
    .from('uk_cleaner_task_photos')
    .select(
      'id, cleaner_id, cleaner_name, qr_code_id, area_type, task_id, photo_data, photo_timestamp, created_at',
    )
    .order('photo_timestamp', { ascending: false, nullsFirst: true })
    .limit(limit * 2)

  photosBuilder = photosBuilder.gte('photo_timestamp', windowStartIso)

  const [selectionsRes, photosRes] = await Promise.all([selectionsBuilder, photosBuilder])

  if (selectionsRes.error) {
    console.warn('Failed to load task selections for manager activity', selectionsRes.error)
  }
  if (photosRes.error) {
    console.warn('Failed to load task photos for manager activity', photosRes.error)
  }

  const rawSelections = selectionsRes.data ?? []
  const rawPhotos = photosRes.data ?? []

  const selectionRows = rawSelections.filter((row) =>
    matchesCleanerScope({ cleaner_id: row.cleaner_id, cleaner_name: row.cleaner_name ?? null }),
  )

  const photoRows = rawPhotos.filter((row) =>
    matchesCleanerScope({ cleaner_id: row.cleaner_id, cleaner_name: row.cleaner_name ?? null }),
  )

  if (restrictToManagedCleaners && !selectionRows.length && !photoRows.length) {
    console.warn(
      'No scoped activity matched cleaners after filtering recent activity feed; returning empty result to avoid leakage.',
    )
    return []
  }

  const candidateCleanerIds = new Set<string>()
  const addCandidateId = (value?: string | number | null) => {
    if (value === null || value === undefined) return
    const trimmed = String(value).trim()
    if (!trimmed) return
    candidateCleanerIds.add(trimmed)
  }

  selectionRows.forEach((row) => {
    addCandidateId(row.cleaner_id)
    registerRosterName(row.cleaner_name)
  })
  photoRows.forEach((row) => {
    addCandidateId(row.cleaner_id)
    registerRosterName(row.cleaner_name)
  })

  const photoCountMap = new Map<string, number>()
  photoRows.forEach((row) => {
    const associationKey = resolveAssociationKey(row.cleaner_id, row.cleaner_name ?? null, row.qr_code_id ?? null)
    if (!associationKey) return
    photoCountMap.set(associationKey, (photoCountMap.get(associationKey) ?? 0) + 1)
  })

  const photoSequenceRemainingMap = new Map<string, number>()
  photoCountMap.forEach((total, key) => {
    photoSequenceRemainingMap.set(key, total)
  })

  const idsToFetch = Array.from(candidateCleanerIds).filter((id) => !cleanerNameMap.has(id))
  if (idsToFetch.length) {
    try {
      const fetchedCleaners = await fetchCleanersByIds(idsToFetch)
      fetchedCleaners.forEach((cleaner) => {
        const displayName = `${cleaner.first_name ?? ''} ${cleaner.last_name ?? ''}`.trim()
        registerCleanerName(cleaner.id, displayName)
      })
    } catch (error) {
      console.warn('Unable to fetch additional cleaner names for recent activity feed', error)
    }
  }

  const resolveCleanerName = (id: string | null, fallback?: string | null) => {
    const trimmedId = id ? id.trim() : ''
    if (trimmedId && cleanerNameMap.has(trimmedId)) {
      return cleanerNameMap.get(trimmedId) ?? 'Cleaner'
    }
    const formattedFallback = normalizeCleanerName(fallback)
    if (formattedFallback && formattedFallback !== 'Unknown Cleaner') {
      return formattedFallback
    }
    if (trimmedId) {
      return trimmedId
    }
    return 'Cleaner'
  }

  const qrCodeIds = Array.from(
    new Set(
      [...selectionRows, ...photoRows]
        .map((row) => row.qr_code_id)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
  )

  const qrMetadataMap = new Map<string, { area: string | null; customer: string | null }>()

  if (qrCodeIds.length) {
    const { data: qrRows, error: qrError } = await supabase
      .from('building_qr_codes')
      .select('qr_code_id, building_area, customer_name, area_description')
      .in('qr_code_id', qrCodeIds)

    if (qrError) {
      console.warn('Failed to load QR metadata for recent activity feed', qrError)
    } else {
      ;(qrRows ?? []).forEach((row) => {
        if (!row?.qr_code_id) return
        const areaLabel = row.building_area?.trim() || row.area_description?.trim() || null
        const customerLabel = row.customer_name?.trim() || null
        qrMetadataMap.set(row.qr_code_id, { area: areaLabel, customer: customerLabel })
      })
    }
  }

  const entries: ManagerActivityRow[] = []

  selectionRows.forEach((row) => {
    const cleanerId = row.cleaner_id ? String(row.cleaner_id).trim() : null
    const cleanerName = resolveCleanerName(cleanerId, row.cleaner_name ?? null)
    const qrMeta = row.qr_code_id ? qrMetadataMap.get(row.qr_code_id) : undefined
    let siteLabel = resolveActivityDisplayLabel(qrMeta?.customer)
    let areaLabel = resolveActivityDisplayLabel(qrMeta?.area)
    if (!siteLabel || !areaLabel) {
      const parsed = deriveLocationFromQrId(row.qr_code_id)
      if (!siteLabel) {
        siteLabel = parsed?.site ?? null
      }
      if (!areaLabel) {
        areaLabel = parsed?.area ?? (row.qr_code_id ? normalizeActivityLabel(row.qr_code_id) : null)
      }
    }
    if (areaLabel && areaLabel.includes('-')) {
      const refined = deriveLocationFromQrId(areaLabel)
      if (refined?.area) {
        areaLabel = refined.area
        if (!siteLabel) {
          siteLabel = refined.site
        }
      }
    }
    const selectedTasks = parseTaskList(row.selected_tasks)
    const completedTasks = parseTaskList(row.completed_tasks)
    const detailParts: string[] = []
    const associationKey = resolveAssociationKey(row.cleaner_id, row.cleaner_name ?? null, row.qr_code_id ?? null)
    const aggregatePhotoCount = associationKey ? photoCountMap.get(associationKey) ?? 0 : 0

    if (selectedTasks.length || completedTasks.length) {
      detailParts.push(`${completedTasks.length}/${selectedTasks.length || completedTasks.length} tasks complete`)
    }
    if (row.qr_code_id) {
      detailParts.push(`QR ${row.qr_code_id}`)
    }

    entries.push({
      id: `task-${row.id}`,
      cleaner_id: cleanerId,
      cleaner_name: cleanerName,
      action: completedTasks.length ? 'Area tasks submitted' : 'Area tasks started',
      timestamp: row.timestamp ?? null,
      detail: detailParts.length ? detailParts.join(' • ') : null,
      site: siteLabel,
      area: areaLabel,
      comments: null,
      photo_url: null,
      entry_type: 'task',
      total_task_count: selectedTasks.length,
      completed_task_count: completedTasks.length,
      photo_count: aggregatePhotoCount,
    })
  })

  photoRows.forEach((row) => {
    const cleanerId = row.cleaner_id ? String(row.cleaner_id).trim() : null
    const cleanerName = resolveCleanerName(cleanerId, row.cleaner_name ?? null)
    const qrMeta = row.qr_code_id ? qrMetadataMap.get(row.qr_code_id) : undefined
    let siteLabel = resolveActivityDisplayLabel(qrMeta?.customer)
    let areaLabel = resolveActivityDisplayLabel(qrMeta?.area)
    if (!siteLabel || !areaLabel) {
      const parsed = deriveLocationFromQrId(row.qr_code_id)
      if (!siteLabel) {
        siteLabel = parsed?.site ?? null
      }
      if (!areaLabel) {
        areaLabel = parsed?.area ?? (row.qr_code_id ? normalizeActivityLabel(row.qr_code_id) : null)
      }
    }
    if (areaLabel && areaLabel.includes('-')) {
      const refined = deriveLocationFromQrId(areaLabel)
      if (refined?.area) {
        areaLabel = refined.area
        if (!siteLabel) {
          siteLabel = refined.site
        }
      }
    }
    const timestamp = row.photo_timestamp ?? row.created_at ?? null
    const detailParts: string[] = []
    const associationKey = resolveAssociationKey(row.cleaner_id, row.cleaner_name ?? null, row.qr_code_id ?? null)
    const aggregatePhotoCount = associationKey ? photoCountMap.get(associationKey) ?? 1 : 1
    let remainingPhotos = associationKey ? photoSequenceRemainingMap.get(associationKey) ?? aggregatePhotoCount : aggregatePhotoCount
    if (remainingPhotos < 0) {
      remainingPhotos = 0
    }
    const photoIndex = aggregatePhotoCount - remainingPhotos + 1
    const completedForDisplay = Math.max(aggregatePhotoCount - photoIndex, 0)
    if (associationKey) {
      photoSequenceRemainingMap.set(associationKey, Math.max(remainingPhotos - 1, 0))
    }

    if (row.task_id) detailParts.push(`Task ${row.task_id}`)
    if (row.qr_code_id) detailParts.push(`QR ${row.qr_code_id}`)

    entries.push({
      id: `photo-${row.id}`,
      cleaner_id: cleanerId,
      cleaner_name: cleanerName,
      action: 'Task photo uploaded',
      timestamp,
      detail: detailParts.length ? detailParts.join(' • ') : 'Task photo uploaded',
      site: siteLabel,
      area: areaLabel,
      comments: null,
      photo_url: row.photo_data ?? null,
      entry_type: 'photo',
      total_task_count: aggregatePhotoCount,
      completed_task_count: completedForDisplay,
      photo_count: aggregatePhotoCount,
    })
  })

  const datedEntries = entries
    .filter((entry) => entry.timestamp)
    .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))

  if (datedEntries.length < entries.length) {
    const undatedEntries = entries.filter((entry) => !entry.timestamp)
    datedEntries.push(...undatedEntries)
  }

  return datedEntries.slice(0, limit)
}


export async function assignCleanerToManager(managerId: string, cleanerId: string): Promise<void> {
  if (!managerId || !cleanerId) return
  const { error } = await supabase
    .from('manager_cleaners')
    .upsert({ manager_id: managerId, cleaner_id: cleanerId }, { onConflict: 'manager_id,cleaner_id' })
  if (error) {
    console.error('Failed to assign cleaner to manager', error)
    throw error
  }
}

export async function removeCleanerFromManager(managerId: string, cleanerId: string): Promise<void> {
  if (!managerId || !cleanerId) return
  const { error } = await supabase
    .from('manager_cleaners')
    .delete()
    .eq('manager_id', managerId)
    .eq('cleaner_id', cleanerId)
  if (error) {
    console.error('Failed to remove cleaner from manager', error)
    throw error
  }
}

