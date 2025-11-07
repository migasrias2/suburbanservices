import { supabase } from './supabase'

export interface SiteSummary {
  id?: string
  customerName: string
  address: string | null
}

const looksLikeCustomerName = (value?: string | null) => {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  // Skip tokens that are clearly area identifiers (e.g. BOARDROOM_U2)
  if (trimmed.includes('_')) return false
  return true
}

export async function fetchActiveSites(): Promise<SiteSummary[]> {
  const map = new Map<string, SiteSummary>()

  const append = (entry: SiteSummary) => {
    const key = entry.customerName.trim().toLowerCase()
    if (!key) return
    if (!map.has(key)) {
      map.set(key, {
        id: entry.id,
        customerName: entry.customerName.trim(),
        address: entry.address ?? null,
      })
    }
  }

  try {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, address, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) {
      console.warn('Unable to load customers table for ops visits', error)
    } else {
      (data ?? []).forEach((row: any) => {
        if (looksLikeCustomerName(row.name)) {
          append({ id: row.id, customerName: row.name.trim(), address: row.address ?? null })
        }
      })
    }
  } catch (error) {
    console.warn('Error querying customers for ops visits', error)
  }

  if (map.size === 0) {
    try {
      const { data, error } = await supabase
        .from('uk_customers')
        .select('id, display_name, name, address, is_active')
        .eq('is_active', true)
        .order('display_name', { ascending: true, nullsFirst: false })

      if (error) {
        console.warn('Unable to load uk_customers table for ops visits', error)
      } else {
        (data ?? []).forEach((row: any) => {
          const candidate = row.display_name?.trim() || row.name?.trim()
          if (looksLikeCustomerName(candidate)) {
            append({ id: row.id, customerName: candidate, address: row.address ?? null })
          }
        })
      }
    } catch (error) {
      console.warn('Error querying uk_customers for ops visits', error)
    }
  }

  if (map.size === 0) {
    const { data: qrRows, error: qrError } = await supabase
      .from('building_qr_codes')
      .select('customer_name')
      .not('customer_name', 'is', null)

    if (qrError) {
      console.error('Failed to fetch fallback clients from QR codes', qrError)
    } else {
      ;(qrRows ?? []).forEach((row) => {
        const candidate = row.customer_name?.trim()
        if (looksLikeCustomerName(candidate)) {
          append({ customerName: candidate, address: null })
        }
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName))
}


