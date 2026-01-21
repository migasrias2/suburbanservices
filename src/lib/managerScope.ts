type ManagerCustomerScope = {
  managerIds?: string[]
  managerNames?: string[]
  customerTokens: string[]
}

const MANAGER_CUSTOMER_SCOPES: ManagerCustomerScope[] = [
  {
    managerIds: ['df0bf2e7-1a07-4876-949c-6cfe8fe0fac6'],
    customerTokens: ['avtrade'],
  },
  {
    managerIds: ['psm-manager'],
    managerNames: ['james'],
    customerTokens: ['psm marine', 'psm'],
  },
]

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

  const matched = MANAGER_CUSTOMER_SCOPES.filter(matchesScope)
  if (!matched.length) {
    return []
  }

  return uniqueTokens(matched.flatMap((scope) => scope.customerTokens))
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
