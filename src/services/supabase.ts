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

export type BathroomAssistRequest = {
  id: string
  qr_code_id?: string | null
  customer_name: string
  location_label: string
  status: 'pending' | 'accepted' | 'resolved' | 'escalated' | 'cancelled'
  issue_type: string
  issue_description?: string | null
  reported_by?: string | null
  reported_contact?: string | null
  reported_at: string
  accepted_at?: string | null
  accepted_by?: string | null
  accepted_by_name?: string | null
  resolved_at?: string | null
  resolved_by?: string | null
  resolved_by_name?: string | null
  escalated_at?: string | null
  escalation_reason?: string | null
  escalate_after?: string | null
  before_media: any
  after_media: any
  notes?: string | null
  materials_used?: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export type BathroomAssistEvent = {
  id: number
  request_id: string
  event_type: string
  actor_role?: string | null
  actor_id?: string | null
  actor_name?: string | null
  payload: Record<string, any>
  created_at: string
}