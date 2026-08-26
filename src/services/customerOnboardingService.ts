import { supabase, type Customer } from './supabase'
import { QRService, AREA_TASKS, type AreaType, type ManualQRCodeResult } from './qrService'

export function describeError(err: unknown): string {
  if (!err) return 'Unknown error'
  const e = err as { message?: string; details?: string; hint?: string; code?: string }
  const parts = [e.message, e.details, e.hint && `Hint: ${e.hint}`, e.code && `(${e.code})`]
    .filter(Boolean)
  return parts.join(' — ') || (err instanceof Error ? err.message : 'Unknown error')
}

/**
 * supabase-js wraps a non-2xx Edge Function response in a FunctionsHttpError
 * whose `message` is the constant "Edge Function returned a non-2xx status
 * code". The reason the function actually gave us sits unread in `context`,
 * which is a Response — not a parsed body — so `context.error` is always
 * undefined. Read the body instead, or the operator sees nothing useful.
 */
async function describeFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown })?.context

  if (context instanceof Response) {
    let raw = ''
    try {
      raw = await context.clone().text()
    } catch {
      // Body already consumed elsewhere; fall through to the status line.
    }

    if (raw) {
      try {
        const body = JSON.parse(raw)
        const message = body?.error ?? body?.message
        if (message) return String(message)
      } catch {
        return raw.trim()
      }
    }

    return `${fallback} (HTTP ${context.status})`
  }

  return (error as { message?: string })?.message || fallback
}

export type ManagerRole = 'manager' | 'ops_manager'

export type ManagerSummary = {
  id: string
  first_name: string
  last_name: string
  role: ManagerRole | null
  mobile_number: string | null
  username: string | null
}

export type CreatedManager = {
  managerId: string
  password: string
  role: ManagerRole
  firstName: string
  lastName: string
  identifier: string
}

export type AreaInput = {
  name: string
  type: AreaType
  tasks?: string[]
}

export function defaultTasksForType(type: AreaType): string[] {
  return (AREA_TASKS[type] ?? []).map((t) => t.name)
}

export type QrPackItem = {
  label: string
  qrType: 'CLOCK_IN' | 'CLOCK_OUT' | 'FEEDBACK' | 'AREA'
  result: ManualQRCodeResult
}

function getAdminId(): string {
  const id = localStorage.getItem('userId')
  if (!id) throw new Error('Missing admin session')
  return id
}

export async function customerExists(customerId: string): Promise<boolean> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_list_customers', { p_admin_id: adminId })
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string }>
  return rows.some((row) => row.id === customerId)
}

export async function createCustomerBasics(input: {
  name: string
  displayName?: string
  address?: string
  contactEmail?: string
  contactPhone?: string
}): Promise<Customer> {
  const adminId = getAdminId()
  const trimmedName = input.name.trim()
  if (!trimmedName) throw new Error('Customer name is required')

  const { data: created, error: createErr } = await supabase.rpc('admin_create_customer', {
    p_admin_id: adminId,
    p_name: trimmedName,
  })
  if (createErr) throw createErr
  const customer = created as Customer

  const hasDetails =
    (input.displayName && input.displayName.trim() !== trimmedName) ||
    !!input.address?.trim() ||
    !!input.contactEmail?.trim() ||
    !!input.contactPhone?.trim()

  if (!hasDetails) return customer

  const { data: updated, error: updateErr } = await supabase.rpc('admin_update_customer_details', {
    p_admin_id: adminId,
    p_customer_id: customer.id,
    p_display_name: input.displayName?.trim() || null,
    p_address: input.address?.trim() || null,
    p_contact_email: input.contactEmail?.trim() || null,
    p_contact_phone: input.contactPhone?.trim() || null,
  })
  if (updateErr) throw updateErr
  return (updated as Customer) ?? customer
}

export async function listManagers(): Promise<ManagerSummary[]> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_list_managers', { p_admin_id: adminId })
  if (error) throw error
  return (data ?? []) as ManagerSummary[]
}

export async function listAssignedManagers(customerId: string): Promise<ManagerSummary[]> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_list_customer_managers', {
    p_admin_id: adminId,
    p_customer_id: customerId,
  })
  if (error) throw error
  return ((data ?? []) as any[]).map((row) => ({
    id: row.manager_id,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    mobile_number: row.mobile_number,
    username: null,
  }))
}

export async function createManagerAccount(input: {
  firstName: string
  lastName: string
  phone?: string
  username?: string
  role: ManagerRole
}): Promise<CreatedManager> {
  const adminId = getAdminId()
  const payload = {
    adminId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: input.phone?.trim() || undefined,
    username: input.username?.trim() || undefined,
    role: input.role,
  }
  const { data, error } = await supabase.functions.invoke('admin-create-manager', { body: payload })
  if (error) {
    throw new Error(await describeFunctionError(error, 'Failed to create manager'))
  }
  if (!data?.managerId || !data?.password) {
    throw new Error('Manager created but no credentials returned')
  }
  return data as CreatedManager
}

export async function assignManagerToCustomer(managerId: string, customerId: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_assign_manager_to_customer', {
    p_admin_id: adminId,
    p_manager_id: managerId,
    p_customer_id: customerId,
  })
  if (error) throw error
}

export async function unassignManagerFromCustomer(managerId: string, customerId: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_unassign_manager_from_customer', {
    p_admin_id: adminId,
    p_manager_id: managerId,
    p_customer_id: customerId,
  })
  if (error) throw error
}

export async function createAreaForCustomer(input: {
  customerId: string
  customerName: string
  area: AreaInput
}): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_create_area', {
    p_admin_id: adminId,
    p_customer_id: input.customerId,
    p_area_name: input.area.name.trim(),
  })
  if (error) throw error

  const customTasks = input.area.tasks
    ?.map((t) => t.trim())
    .filter((t) => t.length > 0)
  const tasks = customTasks && customTasks.length > 0
    ? customTasks
    : defaultTasksForType(input.area.type)
  if (tasks.length > 0) {
    const { error: seedErr } = await supabase.rpc('admin_seed_area_tasks', {
      p_admin_id: adminId,
      p_customer_name: input.customerName,
      p_area_name: input.area.name.trim(),
      p_area_type: input.area.type,
      p_tasks: tasks,
    })
    if (seedErr) {
      console.warn(`Failed to seed tasks for area "${input.area.name}":`, seedErr)
    }
  }
}

// Presets
export type AreaPreset = {
  id: string
  name: string
  items: AreaInput[]
  created_at: string
  updated_at: string
}

export async function listPresets(): Promise<AreaPreset[]> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_list_presets', { p_admin_id: adminId })
  if (error) throw error
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    items: Array.isArray(row.items) ? row.items : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}

export async function createPreset(name: string, items: AreaInput[]): Promise<AreaPreset> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_create_preset', {
    p_admin_id: adminId,
    p_name: name,
    p_items: items as any,
  })
  if (error) throw error
  return data as AreaPreset
}

export async function updatePreset(id: string, name: string, items: AreaInput[]): Promise<AreaPreset> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_update_preset', {
    p_admin_id: adminId,
    p_preset_id: id,
    p_name: name,
    p_items: items as any,
  })
  if (error) throw error
  return data as AreaPreset
}

export async function deletePreset(id: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_delete_preset', {
    p_admin_id: adminId,
    p_preset_id: id,
  })
  if (error) throw error
}

// Users
export type AppUserRole = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

export type ManagedUser = {
  user_id: string
  role: AppUserRole
  first_name: string
  last_name: string
  identifier: string | null
  is_active: boolean
  created_at: string
}

export async function listAllUsers(): Promise<ManagedUser[]> {
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_list_all_users', { p_admin_id: adminId })
  if (error) throw error
  return (data ?? []) as ManagedUser[]
}

export async function renameUser(role: AppUserRole, userId: string, firstName: string, lastName: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_rename_user', {
    p_admin_id: adminId,
    p_role: role,
    p_user_id: userId,
    p_first_name: firstName,
    p_last_name: lastName,
  })
  if (error) throw error
}

export type CreatedUser = {
  userId: string
  password: string
  role: AppUserRole
  firstName: string
  lastName: string
  identifier: string
}

export async function createUserAccount(input: {
  role: AppUserRole
  firstName: string
  lastName: string
  phone?: string
  username?: string
  email?: string
}): Promise<CreatedUser> {
  const adminId = getAdminId()
  const payload = {
    adminId,
    role: input.role,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: input.phone?.trim() || undefined,
    username: input.username?.trim() || undefined,
    email: input.email?.trim() || undefined,
  }
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload })
  if (error) {
    throw new Error(await describeFunctionError(error, 'Failed to create user'))
  }
  if (!data?.userId || !data?.password) {
    throw new Error('User created but no credentials returned')
  }
  return data as CreatedUser
}

export async function deactivateUser(role: AppUserRole, userId: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_deactivate_user', {
    p_admin_id: adminId,
    p_role: role,
    p_user_id: userId,
  })
  if (error) throw error
}

/** A single person -> client/site link, for either a cleaner or a manager. */
export type UserCustomerLink = {
  role: AppUserRole
  userId: string
  customerId: string
  customerLabel: string
}

/**
 * Every site link for every cleaner and manager in one call, so the users list
 * can show who is unassigned without a query per row.
 */
export async function listUserCustomerLinks(): Promise<UserCustomerLink[]> {
  type LinkRow = {
    role: AppUserRole
    user_id: string
    customer_id: string
    customer_label: string | null
  }
  const adminId = getAdminId()
  const { data, error } = await supabase.rpc('admin_list_user_customer_links', { p_admin_id: adminId })
  if (error) throw error
  return ((data ?? []) as LinkRow[]).map((row) => ({
    role: row.role,
    userId: row.user_id,
    customerId: row.customer_id,
    customerLabel: row.customer_label ?? 'Unnamed client',
  }))
}

export async function assignCleanerToCustomer(cleanerId: string, customerId: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_assign_cleaner_to_customer', {
    p_admin_id: adminId,
    p_cleaner_id: cleanerId,
    p_customer_id: customerId,
  })
  if (error) throw error
}

export async function unassignCleanerFromCustomer(cleanerId: string, customerId: string): Promise<void> {
  const adminId = getAdminId()
  const { error } = await supabase.rpc('admin_unassign_cleaner_from_customer', {
    p_admin_id: adminId,
    p_cleaner_id: cleanerId,
    p_customer_id: customerId,
  })
  if (error) throw error
}

/**
 * Cleaners and managers live in different mapping tables, so callers linking a
 * user to a site dispatch through here rather than branching on role themselves.
 * Admins are unscoped — they already see every site — so there is nothing to link.
 */
export async function assignUserToCustomer(
  role: AppUserRole,
  userId: string,
  customerId: string,
): Promise<void> {
  if (role === 'admin') throw new Error('Admins already have access to every site')
  if (role === 'cleaner') return assignCleanerToCustomer(userId, customerId)
  return assignManagerToCustomer(userId, customerId)
}

export async function unassignUserFromCustomer(
  role: AppUserRole,
  userId: string,
  customerId: string,
): Promise<void> {
  if (role === 'admin') throw new Error('Admins already have access to every site')
  if (role === 'cleaner') return unassignCleanerFromCustomer(userId, customerId)
  return unassignManagerFromCustomer(userId, customerId)
}

export async function generateCustomerQrPack(input: {
  customerId: string
  customerName: string
  areas: AreaInput[]
  onProgress?: (current: number, total: number, label: string) => void
}): Promise<QrPackItem[]> {
  const items: { label: string; qrType: QrPackItem['qrType']; areaName?: string; type: AreaType | undefined }[] = [
    { label: 'Clock In', qrType: 'CLOCK_IN', type: undefined },
    { label: 'Clock Out', qrType: 'CLOCK_OUT', type: undefined },
    { label: 'Feedback', qrType: 'FEEDBACK', type: undefined },
    ...input.areas.map((area) => ({
      label: area.name,
      qrType: 'AREA' as const,
      areaName: area.name,
      type: area.type,
    })),
  ]

  const results: QrPackItem[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    input.onProgress?.(i, items.length, item.label)
    const result = await QRService.createManualQRCode({
      type: item.qrType,
      customerId: input.customerId,
      customerName: input.customerName,
      areaName: item.areaName || item.label,
      category: item.type,
    })
    results.push({ label: item.label, qrType: item.qrType, result })
  }
  input.onProgress?.(items.length, items.length, 'Done')
  return results
}
