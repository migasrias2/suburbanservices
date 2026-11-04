import { supabase } from '../services/supabase'

type ManagerCustomerScope = {
  managerIds?: string[]
  managerNames?: string[]
  customerTokens: string[]
}

// Legacy hardcoded fallback (kept while we verify DB-backed scopes in prod).
// New customers should be assigned via the manager_customers table — do not extend this list.
const MANAGER_CUSTOMER_SCOPES: ManagerCustomerScope[] = [
  {
    managerIds: ['df0bf2e7-1a07-4876-949c-6cfe8fe0fac6'],
    customerTokens: ['avtrade'],
  },
  {
    managerIds: ['ce2c8d1a-6e0a-4d78-9746-2cd32983455f', 'bffb28ae-5ed3-46f2-8ec9-9864fab34301'],
    managerNames: ['james'],
    customerTokens: ['psm marine', 'psm'],
  },
]

type DbScopeRow = {
  manager_id: string
  customer_id: string
  customer_label: string
}

const dbScopes: DbScopeRow[] = []
let hydratePromise: Promise<void> | null = null

export const hydrateManagerScopes = async (): Promise<void> => {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('admin_list_manager_customer_scopes')
      if (error) {
        console.warn('hydrateManagerScopes: RPC failed, using hardcoded fallback only', error.message)
        return
      }
      dbScopes.length = 0
      for (const row of (data ?? []) as DbScopeRow[]) {
        if (row.manager_id && row.customer_label) {
          dbScopes.push({
            manager_id: row.manager_id.trim(),
            customer_id: row.customer_id,
            customer_label: row.customer_label.trim().toLowerCase(),
          })
        }
      }
    } catch (err) {
      console.warn('hydrateManagerScopes: unexpected error', err)
    }
  })()
  return hydratePromise
}

export const invalidateManagerScopes = () => {
  hydratePromise = null
  dbScopes.length = 0
}

const normalizeValue = (value?: string | null) => (value ? value.trim().toLowerCase() : '')

const uniqueTokens = (tokens: string[]) =>
  Array.from(new Set(tokens.map((token) => normalizeValue(token)).filter(Boolean)))

export const resolveManagerCustomerScope = (
  managerId?: string | null,
  managerName?: string | null,
): string[] => {
  const id = normalizeValue(managerId ?? undefined)
  const name = normalizeValue(managerName ?? undefined) || normalizeValue(
    typeof window !== 'undefined' ? localStorage.getItem('userName') : undefined,
  )

  const tokens: string[] = []

  if (id) {
    for (const row of dbScopes) {
      if (row.manager_id.toLowerCase() === id) {
        tokens.push(row.customer_label)
      }
    }
  }

  const matchesScope = (scope: ManagerCustomerScope) => {
    if (id && scope.managerIds?.some((candidate) => normalizeValue(candidate) === id)) {
      return true
    }
    if (
      name &&
      scope.managerNames?.some((candidate) => {
        const normalizedCandidate = normalizeValue(candidate)
        return normalizedCandidate ? name.includes(normalizedCandidate) : false
      })
    ) {
      return true
    }
    return false
  }

  for (const scope of MANAGER_CUSTOMER_SCOPES) {
    if (matchesScope(scope)) {
      tokens.push(...scope.customerTokens)
    }
  }

  return uniqueTokens(tokens)
}

export const buildCustomerScopeMatcher = (scopeTokens: string[]) => {
  const normalizedTokens = uniqueTokens(scopeTokens)

  if (!normalizedTokens.length) {
    return (..._fields: Array<string | null | undefined>) => true
  }

  return (...fields: Array<string | null | undefined>) => {
    return fields.some((field) => {
      const normalizedField = normalizeValue(field)
      if (!normalizedField) return false
      return normalizedTokens.some((token) => normalizedField.includes(token))
    })
  }
}

export type ManagerSiteLink = {
  customerId: string | null
  /** Lowercased customer label, as admin_list_manager_customer_scopes derives it. */
  label: string
  tokens: string[]
}

/**
 * The customers linked to ONE manager id, for views that must fail closed.
 *
 * Unlike resolveManagerCustomerScope this never matches on display name (a
 * manager called "James" at another client would otherwise inherit PSM) and
 * returns an empty list, not a wildcard, when nothing is linked.
 */
export const resolveManagerSiteLinks = async (managerId?: string | null): Promise<ManagerSiteLink[]> => {
  const id = normalizeValue(managerId ?? undefined)
  if (!id) return []

  await hydrateManagerScopes()

  const links: ManagerSiteLink[] = dbScopes
    .filter((row) => row.manager_id.toLowerCase() === id)
    .map((row) => ({ customerId: row.customer_id ?? null, label: row.customer_label, tokens: [row.customer_label] }))

  const covered = new Set(links.map((link) => link.label))
  MANAGER_CUSTOMER_SCOPES.forEach((scope) => {
    if (!scope.managerIds?.some((candidate) => normalizeValue(candidate) === id)) return
    const tokens = uniqueTokens(scope.customerTokens)
    if (!tokens.length || tokens.some((token) => covered.has(token))) return
    links.push({ customerId: null, label: tokens[0], tokens })
  })

  return links
}

export const resolveManagerIdsForCustomer = (customerLabel?: string | null): string[] => {
  const normalizedLabel = normalizeValue(customerLabel ?? undefined)
  if (!normalizedLabel) {
    return []
  }

  const managerIds = new Set<string>()

  for (const row of dbScopes) {
    if (normalizedLabel.includes(row.customer_label) || row.customer_label.includes(normalizedLabel)) {
      managerIds.add(row.manager_id)
    }
  }

  for (const scope of MANAGER_CUSTOMER_SCOPES) {
    if (!scope.managerIds?.length) continue
    const matchesCustomer = buildCustomerScopeMatcher(scope.customerTokens)
    if (matchesCustomer(customerLabel)) {
      for (const managerId of scope.managerIds) {
        const normalizedId = normalizeValue(managerId)
        if (normalizedId) {
          managerIds.add(managerId.trim())
        }
      }
    }
  }

  return Array.from(managerIds)
}
