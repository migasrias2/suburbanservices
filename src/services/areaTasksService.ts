import { supabase, type AreaTask } from './supabase'

export type CreateAreaTaskInput = {
  customer_name: string
  area: string
  task_description: string
  task_type?: string | null
  qr_code?: string | null
  active?: boolean
}

export type UpdateAreaTaskInput = {
  task_description?: string
  task_type?: string | null
  area?: string | null
  customer_name?: string
  qr_code?: string | null
  active?: boolean
}

export async function fetchAreaTasks(): Promise<AreaTask[]> {
  const { data, error } = await supabase
    .from('area_tasks')
    .select('*')
    .order('customer_name', { ascending: true, nullsFirst: false })
    .order('area', { ascending: true, nullsFirst: false })
    .order('position', { ascending: true })

  if (error) {
    console.error('Failed to fetch area tasks', error)
    throw error
  }

  return data ?? []
}

export async function createAreaTask(input: CreateAreaTaskInput): Promise<AreaTask> {
  const { data, error } = await supabase
    .from('area_tasks')
    .insert({
      customer_name: input.customer_name,
      area: input.area,
      task_description: input.task_description,
      task_type: input.task_type ?? null,
      qr_code: input.qr_code ?? null,
      active: input.active ?? true,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create area task', error)
    throw error
  }

  return data as AreaTask
}

export async function updateAreaTask(id: string, updates: UpdateAreaTaskInput): Promise<AreaTask> {
  const { data, error } = await supabase
    .from('area_tasks')
    .update({
      ...updates,
      task_type: updates.task_type ?? null,
      qr_code: updates.qr_code ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update area task', error)
    throw error
  }

  return data as AreaTask
}

export async function deleteAreaTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('area_tasks')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Failed to delete area task', error)
    throw error
  }
}


