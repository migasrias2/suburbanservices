import { supabase, type Customer } from "./supabase";

export async function fetchCustomers(): Promise<Customer[]> {
  const adminId = localStorage.getItem('userId');
  const query = supabase
    .from('uk_customers')
    .select('*')
    .order('display_name', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true, nullsFirst: false });

  if (adminId) {
    // when admin, we rely on RPC (which already reads uk_customers)
    const { data, error } = await supabase.rpc('admin_list_customers', { p_admin_id: adminId });
    if (error) {
      console.error('Failed to fetch customers', error);
      throw error;
    }
    return (data ?? []) as Customer[];
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch customers', error);
    throw error;
  }

  return (data ?? []) as Customer[];
}

export async function createCustomer(name: string): Promise<Customer> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Customer name is required");
  }

  const adminId = localStorage.getItem('userId');
  if (!adminId) {
    throw new Error('Missing admin session');
  }

  const { data, error } = await supabase.rpc('admin_create_customer', {
    p_admin_id: adminId,
    p_name: trimmed,
  });

  if (error) {
    console.error("Failed to create customer", error);
    throw error;
  }

  return data as Customer;
}

export async function softDeleteCustomer(customerId: string): Promise<Customer> {
  const adminId = localStorage.getItem('userId');
  if (!adminId) throw new Error('Missing admin session');
  const { data, error } = await supabase.rpc('admin_soft_delete_customer', {
    p_admin_id: adminId,
    p_customer_id: customerId,
  });
  if (error) {
    console.error('Failed to delete customer', error);
    throw error;
  }
  return data as Customer;
}
