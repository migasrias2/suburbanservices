import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Define types for clean database schema
export type Cleaner = {
  id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  email?: string;
  password_hash: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Manager = {
  id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  email?: string;
  password_hash: string;
  employee_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Admin = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Customer = {
  id: string
  name: string | null
  display_name?: string | null
  customer_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  address?: string | null
  is_active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export type Site = {
  id: string;
  customer_id: string;
  name: string;
  address?: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Area = {
  id: string;
  site_id: string;
  name: string;
  description?: string;
  floor?: string;
  category?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AreaTask = {
  id: string;
  customer_name: string;
  area: string | null;
  qr_code: string | null;
  task_type: string | null;
  task_description: string;
  position: number | null;
  sort_order: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type QRCode = {
  id: string;
  code: string;
  type: 'clock_in' | 'clock_out' | 'area' | 'task' | 'feedback';
  site_id?: string;
  area_id?: string;
  data?: any; // JSON data
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type LiveTracking = {
  id: number;
  cleaner_id: string;
  site_id?: string;
  area_id?: string;
  event_type: string;
  qr_code_id?: string;
  latitude?: number;
  longitude?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CleanerLog = {
  id: number;
  cleaner_id: string;
  action: string;
  qr_code_id?: string;
  site_id?: string;
  area_id?: string;
  latitude?: number;
  longitude?: number;
  device_info?: any;
  comments?: string;
  timestamp: string;
}

export type ManagerCleaner = {
  manager_id: string
  cleaner_id: string
  created_at: string
}

// Legacy type aliases for backward compatibility
export type UKCleaner = Cleaner;
export type UKAdmin = Admin;
export type UKOperationsManager = Manager;
export type QRCodeData = QRCode;
export type UKCleanerLog = CleanerLog;
export type UKSite = Site;