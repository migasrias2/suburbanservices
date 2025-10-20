import { supabase } from './supabase'

export type AdminCustomerArea = {
  customer_id: string
  customer_name: string
  area_id: string | null
  area_name: string | null
}

export async function adminListCustomerAreas(adminId: string): Promise<AdminCustomerArea[]> {
  const { data, error } = await supabase.rpc('admin_list_customer_areas', { p_admin_id: adminId })
  if (error) throw error
  return (data ?? []) as AdminCustomerArea[]
}

export async function adminCreateArea(params: { adminId: string; customerId: string; name: string }) {
  const { data, error } = await supabase.rpc('admin_create_area', {
    p_admin_id: params.adminId,
    p_customer_id: params.customerId,
    p_area_name: params.name.trim(),
  })
  if (error) throw error
  return data
}
