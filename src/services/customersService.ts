import { supabase, type Customer } from "./supabase";

export async function fetchCustomers(): Promise<Customer[]> {
  const adminId = localStorage.getItem('userId');
  if (!adminId) {
    // Fallback to public read if not admin session
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("name", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("Failed to fetch customers", error);
      throw error;
    }

    return data ?? [];
  }

  const { data, error } = await supabase.rpc('admin_list_customers', { p_admin_id: adminId });

  if (error) {
    console.error("Failed to fetch customers", error);
    throw error;
  }

  return data ?? [];
}

export async function createCustomer(name: string): Promise<Customer> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Customer name is required");
  }

  // Use admin RPC to bypass RLS safely. The admin id is stored in localStorage
  // as userId when an admin logs in via admin_login.
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
