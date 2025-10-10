import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { AreaTasksTree } from './AreaTasksTree'
import { AreaTaskForm, type AreaTaskFormValues } from './AreaTaskForm'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { AreaTask } from '@/services/supabase'
import { createAreaTask, deleteAreaTask, fetchAreaTasks, updateAreaTask } from '@/services/areaTasksService'

type SheetMode = 'create' | 'edit'

export const AreaTasksPage = () => {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState<SheetMode>('create')
  const [editingTask, setEditingTask] = useState<AreaTask | null>(null)
  const [prefillData, setPrefillData] = useState<{ customer_name?: string; area?: string }>({})
  const [search, setSearch] = useState('')
  const [pendingDelete, setPendingDelete] = useState<AreaTask | null>(null)

  const tasksQuery = useQuery({
    queryKey: ['area_tasks'],
    queryFn: fetchAreaTasks,
  })

  const createMutation = useMutation({
    mutationFn: createAreaTask,
    onSuccess: () => {
      toast({ title: 'Task created', description: 'The task has been added successfully.' })
      queryClient.invalidateQueries({ queryKey: ['area_tasks'] })
      setSheetOpen(false)
    },
    onError: (error: unknown) => {
      console.error(error)
      toast({
        title: 'Could not create task',
        description: 'Please try again or contact support if the issue persists.',
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AreaTaskFormValues }) =>
      updateAreaTask(id, {
        customer_name: values.customer_name,
        area: values.area,
        task_description: values.task_description,
        task_type: values.task_type,
        qr_code: values.qr_code,
        active: values.active,
      }),
    onSuccess: () => {
      toast({ title: 'Task updated', description: 'Changes saved successfully.' })
      queryClient.invalidateQueries({ queryKey: ['area_tasks'] })
      setSheetOpen(false)
    },
    onError: () => {
      toast({
        title: 'Could not update task',
        description: 'Please try again or contact support if the issue persists.',
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAreaTask,
    onSuccess: () => {
      toast({ title: 'Task deleted' })
      queryClient.invalidateQueries({ queryKey: ['area_tasks'] })
      setPendingDelete(null)
    },
    onError: () => {
      toast({ title: 'Could not delete task', variant: 'destructive' })
    },
  })

  useEffect(() => {
    if (!tasksQuery.data?.length) return
    const groupedCustomerNode = new Set<string>()
    const areaNode = new Set<string>()
    tasksQuery.data.forEach((task) => {
      const customer = task.customer_name?.trim() || 'Unassigned Customer'
      const area = task.area?.trim() || 'Unassigned Area'
      groupedCustomerNode.add(`customer:${customer}`)
      areaNode.add(`area:${customer}:${area}`)
    })
    setExpandedNodes((prev) => {
      const next: Record<string, boolean> = { ...prev }
      groupedCustomerNode.forEach((id) => {
        if (typeof next[id] === 'undefined') next[id] = false
      })
      areaNode.forEach((id) => {
        if (typeof next[id] === 'undefined') next[id] = false
      })
      return next
    })
  }, [tasksQuery.data])

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasksQuery.data ?? []
    const query = search.toLowerCase()
    return (tasksQuery.data ?? []).filter((task) => {
      return [
        task.customer_name,
        task.area,
        task.task_description,
        task.task_type,
        task.qr_code,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    })
  }, [tasksQuery.data, search])

  const openCreateSheet = useCallback((prefill?: { customer: string; area: string }) => {
    setSheetMode('create')
    setEditingTask(null)
    setPrefillData({
      customer_name: prefill?.customer ?? '',
      area: prefill?.area ?? '',
    })
    setSheetOpen(true)
  }, [])

  const openEditSheet = useCallback((task: AreaTask) => {
    setSheetMode('edit')
    setEditingTask(task)
    setPrefillData({})
    setSheetOpen(true)
  }, [])

  const handleSubmit = async (values: AreaTaskFormValues) => {
    if (sheetMode === 'create') {
      await createMutation.mutateAsync({
        customer_name: values.customer_name,
        area: values.area,
        task_description: values.task_description,
        task_type: values.task_type,
        qr_code: values.qr_code,
        active: values.active,
      })
    } else if (editingTask) {
      await updateMutation.mutateAsync({ id: editingTask.id, values })
    }
  }

  const handleDelete = () => {
    if (!pendingDelete) return
    deleteMutation.mutate(pendingDelete.id)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-gray-100 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-[#00339B]">Area Tasks</h1>
            <p className="text-sm text-gray-500">Browse tasks per customer and area, then update as needed.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2">
              <Label htmlFor="area-task-search" className="text-xs font-medium text-gray-500">
                Search
              </Label>
              <Input
                id="area-task-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Customer, area, or task"
                className="h-8 w-64 border-0 bg-transparent text-sm focus-visible:ring-0"
              />
            </div>
            <Button onClick={() => openCreateSheet()} className="rounded-full bg-[#00339B] px-5 py-2 text-sm font-semibold hover:bg-[#00297a]">
              Add Task
            </Button>
          </div>
        </div>
      </div>

      {tasksQuery.isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-[#00339B]" />
            <p className="text-sm text-gray-500">Loading tasks...</p>
          </div>
        </div>
      ) : tasksQuery.isError ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-8 text-center">
          <h2 className="text-lg font-semibold text-rose-600">Unable to load tasks</h2>
          <p className="mt-2 text-sm text-rose-500">Please refresh the page or try again later.</p>
        </div>
      ) : (
        <AreaTasksTree
          tasks={filteredTasks}
          expandedNodes={expandedNodes}
          onToggleNode={(nodeId) =>
            setExpandedNodes((prev) => ({
              ...prev,
              [nodeId]: !prev[nodeId],
            }))
          }
          onEditTask={(task) => openEditSheet(task)}
          onDeleteTask={setPendingDelete}
          onCreateTask={({ customer, area }) => openCreateSheet({ customer, area })}
        />
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-xl overflow-y-auto border-0 bg-gradient-to-b from-white via-[#f5f7ff] to-white shadow-[0_20px_60px_rgba(0,23,71,0.12)]"
        >
          <SheetHeader className="space-y-3">
            <SheetTitle className="text-3xl font-semibold text-[#00339B]">
              {sheetMode === 'create' ? 'Add Task' : 'Edit Task'}
            </SheetTitle>
            <SheetDescription className="text-base text-gray-500">
              {sheetMode === 'create'
                ? 'Add a new task to a specific customer area.'
                : 'Update the details for this task.'}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-8 rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_40px_rgba(11,35,75,0.08)]">
            <AreaTaskForm
              defaultValues={editingTask ?? prefillData}
              onSubmit={handleSubmit}
              submitting={createMutation.isPending || updateMutation.isPending}
            />
          </div>
          <SheetFooter className="mt-8 justify-between gap-3">
            {sheetMode === 'edit' && editingTask && (
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                onClick={() => setPendingDelete(editingTask)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Task
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-3xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The task will be permanently removed from the area.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className={cn('rounded-full bg-rose-600 hover:bg-rose-700', deleteMutation.isPending && 'opacity-80')}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

