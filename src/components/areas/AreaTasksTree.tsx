import { useMemo } from 'react'
import type { KeyboardEvent } from 'react'
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, MoreVertical, Plus, Trash2, Pencil, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Swipeable } from '@/components/ui/swipeable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { AreaTask } from '@/services/supabase'

export type TreeAreaGroup = {
  customer: string
  areas: TreeArea[]
}

export type TreeArea = {
  name: string
  tasks: AreaTask[]
}

export interface AreaTasksTreeProps {
  tasks: AreaTask[]
  expandedNodes: Record<string, boolean>
  onToggleNode: (nodeId: string) => void
  onEditTask: (task: AreaTask) => void
  onDeleteTask: (task: AreaTask) => void
  onCreateTask: (payload: { customer: string; area: string }) => void
  onReorderTasks: (payload: { customer: string; area: string; tasks: AreaTask[] }) => void
  extraCustomers?: string[]
  onAddCustomer?: () => void
  onAddArea?: (payload: { customer: string }) => void
  extraAreasByCustomer?: Record<string, string[]>
}

const buildTree = (tasks: AreaTask[]): TreeAreaGroup[] => {
  const map = new Map<string, Map<string, AreaTask[]>>()

  tasks.forEach((task) => {
    const customer = task.customer_name?.trim() || task.customer_name || 'Unassigned Customer'
    const area = task.area?.trim() || 'Unassigned Area'
    if (!map.has(customer)) {
      map.set(customer, new Map())
    }
    const areaMap = map.get(customer)!
    if (!areaMap.has(area)) {
      areaMap.set(area, [])
    }
    areaMap.get(area)!.push(task)
  })

  return Array.from(map.entries())
    .sort(([customerA], [customerB]) => customerA.localeCompare(customerB))
    .map(([customer, areaMap]) => ({
      customer,
      areas: Array.from(areaMap.entries())
        .sort(([areaA], [areaB]) => areaA.localeCompare(areaB))
        .map(([name, areaTasks]) => ({
          name,
          tasks: [...areaTasks].sort((a, b) => {
            const orderA = a.sort_order ?? a.position ?? Number.MAX_SAFE_INTEGER
            const orderB = b.sort_order ?? b.position ?? Number.MAX_SAFE_INTEGER
            if (orderA !== orderB) return orderA - orderB
            return a.task_description.localeCompare(b.task_description)
          })
        }))
    }))
}

const TaskRow = ({
  task,
  onEditTask,
  onDeleteTask,
}: {
  task: AreaTask
  onEditTask: (task: AreaTask) => void
  onDeleteTask: (task: AreaTask) => void
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const isActive = task.active
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-start justify-between rounded-2xl border px-4 py-3 shadow-sm transition',
        isActive ? 'border-emerald-100 bg-emerald-50/60' : 'border-gray-100 bg-gray-50'
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-1 flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">{task.task_description}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {task.task_type && <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] uppercase tracking-wide text-[#00339B]">{task.task_type}</span>}
            {task.qr_code && <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-gray-600">QR: {task.qr_code}</span>}
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-600')}>
              {isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-gray-100">
            <MoreVertical className="h-4 w-4 text-gray-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-40 rounded-2xl border-0 shadow-lg">
          <DropdownMenuItem className="gap-2" onClick={() => onEditTask(task)}>
            <Pencil className="h-4 w-4" />
            Edit Task
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-rose-600 focus:text-rose-600" onClick={() => onDeleteTask(task)}>
            <Trash2 className="h-4 w-4" />
            Delete Task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const AreaTasksTree = ({
  tasks,
  expandedNodes,
  onToggleNode,
  onEditTask,
  onDeleteTask,
  onCreateTask,
  onReorderTasks,
  extraCustomers,
  onAddCustomer,
  onAddArea,
  extraAreasByCustomer,
}: AreaTasksTreeProps) => {
  const tree = useMemo(() => buildTree(tasks), [tasks])
  const extendedTree = useMemo(() => {
    const present = new Set<string>(tree.map((g) => g.customer))
    const extras = (extraCustomers ?? [])
      .filter((name) => name && !present.has(name))
      .map((name) => ({ customer: name, areas: [] as TreeArea[] }))
    return [...tree, ...extras].sort((a, b) => a.customer.localeCompare(b.customer))
  }, [tree, extraCustomers])
  const extendedWithAreas = useMemo(() => {
    if (!extraAreasByCustomer) return extendedTree
    return extendedTree.map((group) => {
      const existing = new Set(group.areas.map((a) => a.name))
      const extraNames = extraAreasByCustomer[group.customer] ?? []
      const extraAreas = extraNames
        .filter((n) => n && !existing.has(n))
        .map((name) => ({ name, tasks: [] as AreaTask[] }))
      return {
        ...group,
        areas: [...group.areas, ...extraAreas].sort((a, b) => a.name.localeCompare(b.name)),
      }
    })
  }, [extendedTree, extraAreasByCustomer])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  if (!tree.length) {
    return (
      <Card className="rounded-3xl border border-dashed border-[#00339B]/20 bg-white shadow-none">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="h-16 w-16 rounded-full bg-[#00339B]/10 flex items-center justify-center">
            <Plus className="h-6 w-6 text-[#00339B]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#00339B]">No tasks found</h3>
            <p className="text-sm text-gray-500">Start by adding a task to an area.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const renderCustomerRow = (group: TreeAreaGroup) => {
    const nodeId = `customer:${group.customer}`
    const provided = expandedNodes[nodeId]
    const defaultExpanded = group.areas.some((a) => a.tasks.length > 0)
    const isExpanded = typeof provided === 'boolean' ? provided : defaultExpanded
    const content = (
      <div
        className={cn(
          'rounded-3xl border bg-white shadow-sm transition-colors',
          isExpanded ? 'border-[#00339B]/20 bg-[#f6f8ff]' : 'border-gray-100'
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onToggleNode(nodeId)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onToggleNode(nodeId)
            }
          }}
          className="flex w-full items-center justify-between rounded-3xl px-6 py-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00339B]/10">
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-[#00339B]" />
              ) : (
                <ChevronRight className="h-5 w-5 text-[#00339B]" />
              )}
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">{group.customer}</p>
              <p className="text-xs text-gray-500">{group.areas.length} area{group.areas.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {/* Removed pill New Task button as requested */}
        </div>
        {isExpanded && (
          <div className="space-y-4 border-t border-gray-100 px-6 py-5">
            {group.areas.length === 0 && onAddArea ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onAddArea({ customer: group.customer })
                }}
                className="w-full rounded-2xl border-2 border-dotted border-gray-300 bg-white/80 px-5 py-6 text-sm font-semibold text-[#00339B] transition hover:border-[#00339B]/60 hover:bg-[#f0f4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Create area
                </span>
              </button>
            ) : (
              group.areas.map((area) => renderAreaRow(group.customer, area))
            )}
          </div>
        )}
      </div>
    )

    return (
      <Swipeable
        key={group.customer}
        action={{
          icon: <Trash2 className="h-4 w-4" />,
          label: 'Delete',
          onClick: () => {
            // Consumers will handle actual deletion via parent callback in future
            const event = new CustomEvent('delete-customer', { detail: { customer: group.customer } })
            window.dispatchEvent(event)
          },
          className: 'rounded-none',
        }}
        className="rounded-3xl"
      >
        <div className="rounded-3xl overflow-hidden bg-white">{content}</div>
      </Swipeable>
    )
  }

  const renderAreaRow = (customer: string, area: TreeArea) => {
    const nodeId = `area:${customer}:${area.name}`
    const provided = expandedNodes[nodeId]
    const defaultExpanded = area.tasks.length > 0
    const isExpanded = typeof provided === 'boolean' ? provided : defaultExpanded
    const areaTasks = area.tasks
    const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = areaTasks.findIndex((task) => task.id === active.id)
      const newIndex = areaTasks.findIndex((task) => task.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const newOrder = arrayMove(areaTasks, oldIndex, newIndex)
      onReorderTasks({ customer, area: area.name, tasks: newOrder })
    }
    return (
      <div
        key={area.name}
        className={cn(
          'rounded-2xl border transition-colors',
          isExpanded ? 'border-[#00339B]/20 bg-[#eef2ff]' : 'border-gray-100 bg-white/70'
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onToggleNode(nodeId)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onToggleNode(nodeId)
            }
          }}
          className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00339B]/10">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-[#00339B]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[#00339B]" />
              )}
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-gray-900">{area.name}</p>
              <p className="text-xs text-gray-500">{area.tasks.length} task{area.tasks.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {/* Removed pill Add Task button as requested */}
        </div>
        {isExpanded && (
          <div className="space-y-3 border-t border-gray-100 bg-white px-5 py-4">
            {areaTasks.length === 0 ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onCreateTask({ customer, area: area.name })
                }}
                className="w-full rounded-2xl border-2 border-dotted border-gray-300 bg-white/80 px-5 py-6 text-sm font-semibold text-[#00339B] transition hover:border-[#00339B]/60 hover:bg-[#f0f4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Create task
                </span>
              </button>
            ) : (
              <>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={areaTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                    {areaTasks.map((task) => (
                      <TaskRow key={task.id} task={task} onEditTask={onEditTask} onDeleteTask={onDeleteTask} />
                    ))}
                  </SortableContext>
                </DndContext>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCreateTask({ customer, area: area.name })
                    }}
                    className="mt-2 w-full rounded-xl border-2 border-dotted border-gray-300 bg-white/80 px-4 py-3 text-xs font-semibold text-[#00339B] transition hover:border-[#00339B]/60 hover:bg-[#f0f4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Plus className="h-3 w-3" />
                      Add another task
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-6 pt-3">
      {extendedWithAreas.map((group) => renderCustomerRow(group))}
      {onAddCustomer && (
        <button
          type="button"
          onClick={onAddCustomer}
          className="mt-2 w-full rounded-3xl border-2 border-dotted border-gray-300 bg-white/80 px-6 py-6 text-sm font-semibold text-[#00339B] transition hover:border-[#00339B]/60 hover:bg-[#f6f8ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00339B]/40"
        >
          <span className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create new customer
          </span>
        </button>
      )}
    </div>
  )
}

