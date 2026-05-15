import { supabase } from './supabase'

export async function hasOpenClockInToday(cleanerId: string): Promise<boolean> {
  if (!cleanerId) return false

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const { data, error } = await supabase
    .from('time_attendance')
    .select('id')
    .eq('cleaner_uuid', cleanerId)
    .is('clock_out', null)
    .gte('clock_in', start.toISOString())
    .lt('clock_in', end.toISOString())
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('hasOpenClockInToday failed', error)
    return true
  }

  return Boolean(data)
}
