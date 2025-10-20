import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Search, UserPlus } from "lucide-react";
import { AreaTasksTree } from "./AreaTasksTree";
import { AreaTaskForm, type AreaTaskFormValues } from "./AreaTaskForm";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AreaTask } from "@/services/supabase";
import {
  createAreaTask,
  deleteAreaTask,
  fetchAreaTasks,
  reorderAreaTasks,
  updateAreaTask,
} from "@/services/areaTasksService";
import { createCustomer, fetchCustomers, softDeleteCustomer } from "@/services/customersService";

type SheetMode = "create" | "edit";

export const AreaTasksPage = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedInitialized, setExpandedInitialized] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("create");
  const [editingTask, setEditingTask] = useState<AreaTask | null>(null);
  const [prefillData, setPrefillData] = useState<{
    customer_name?: string;
    area?: string;
  }>({});
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AreaTask | null>(null);
  const [pendingReorders, setPendingReorders] = useState<
    Record<string, AreaTask[]>
  >({});
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [addAreaOpen, setAddAreaOpen] = useState<null | { customerId: string; customerName: string }>(null);
  const [newAreaName, setNewAreaName] = useState("");
  const [extraAreasByCustomer, setExtraAreasByCustomer] = useState<Record<string, string[]>>({});
  const [addTaskOpen, setAddTaskOpen] = useState<null | { customer: string; area: string }>(null);
  const [newTaskDescription, setNewTaskDescription] = useState("");

  const tasksQuery = useQuery({
    queryKey: ["area_tasks"],
    queryFn: fetchAreaTasks,
  });

  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const createMutation = useMutation({
    mutationFn: createAreaTask,
    onSuccess: () => {
      toast({
        title: "Task created",
        description: "The task has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["area_tasks"] });
      setSheetOpen(false);
      setAddTaskOpen(null);
      setNewTaskDescription("");
    },
    onError: (error: unknown) => {
      console.error(error);
      toast({
        title: "Could not create task",
        description:
          "Please try again or contact support if the issue persists.",
        variant: "destructive",
      });
    },
  });

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
      toast({
        title: "Task updated",
        description: "Changes saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["area_tasks"] });
      setSheetOpen(false);
    },
    onError: () => {
      toast({
        title: "Could not update task",
        description:
          "Please try again or contact support if the issue persists.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAreaTask,
    onSuccess: () => {
      toast({ title: "Task deleted" });
      queryClient.invalidateQueries({ queryKey: ["area_tasks"] });
      setPendingDelete(null);
    },
    onError: () => {
      toast({ title: "Could not delete task", variant: "destructive" });
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      const trimmed = customer.name?.trim();
      toast({
        title: "Customer created",
        description: `${trimmed || customer.name} is ready for tasks.`,
      });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setNewCustomerName("");
      setAddCustomerOpen(false);
      if (trimmed) {
        setExpandedNodes((prev) => ({
          ...prev,
          [`customer:${trimmed}`]: true,
        }));
      }
    },
    onError: (error: unknown) => {
      console.error(error);
      toast({
        title: "Could not create customer",
        description:
          error instanceof Error
            ? error.message
            : "Please try again or contact support if the issue persists.",
        variant: "destructive",
      });
    },
  });

  const createAreaMutation = useMutation({
    mutationFn: async ({ customerId, name }: { customerId: string; name: string }) => {
      const adminId = localStorage.getItem('userId') || '';
      const { adminCreateArea } = await import('@/services/areasService');
      return adminCreateArea({ adminId, customerId, name });
    },
    onSuccess: () => {
      toast({ title: 'Area created', description: 'You can now add tasks.' })
      setAddAreaOpen(null)
      setNewAreaName('')
      // Optimistically show the new area in the UI even if there are no tasks yet
      setExtraAreasByCustomer((prev) => {
        const name = (addAreaOpen?.customerName || '').trim()
        const area = newAreaName.trim()
        if (!name || !area) return prev
        const current = prev[name] ?? []
        if (current.includes(area)) return prev
        return { ...prev, [name]: [...current, area] }
      })
      queryClient.invalidateQueries({ queryKey: ['area_tasks'] })
    },
    onError: (error: unknown) => {
      console.error(error)
      toast({ title: 'Could not create area', variant: 'destructive' })
    }
  })

  // Hook up swipe delete action
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { customer: string } | undefined
      if (!detail?.customer) return
      const match = customersQuery.data?.find(c => (c.name?.trim() || '') === detail.customer)
      if (!match?.id) return
      const confirmed = confirm(`Delete customer "${detail.customer}"? This will hide it from the list.`)
      if (!confirmed) return
      try {
        await softDeleteCustomer(match.id)
        toast({ title: 'Customer deleted' })
        queryClient.invalidateQueries({ queryKey: ['customers'] })
        queryClient.invalidateQueries({ queryKey: ['area_tasks'] })
      } catch (err) {
        console.error(err)
        toast({ title: 'Could not delete customer', variant: 'destructive' })
      }
    }
    window.addEventListener('delete-customer', handler as EventListener)
    return () => window.removeEventListener('delete-customer', handler as EventListener)
  }, [customersQuery.data, queryClient, toast])

  useEffect(() => {
    if (expandedInitialized) return;
    if (!tasksQuery.data) {
      // still waiting for data; keep not initialized
      return;
    }
    const groupedCustomerNode = new Set<string>();
    const areaNode = new Set<string>();
    tasksQuery.data.forEach((task) => {
      const customer = task.customer_name?.trim() || "Unassigned Customer";
      const area = task.area?.trim() || "Unassigned Area";
      groupedCustomerNode.add(`customer:${customer}`);
      areaNode.add(`area:${customer}:${area}`);
    });
    const next: Record<string, boolean> = {};
    groupedCustomerNode.forEach((id) => (next[id] = false));
    areaNode.forEach((id) => (next[id] = false));
    setExpandedNodes(next);
    setExpandedInitialized(true);
  }, [tasksQuery.data, expandedInitialized]);

  const filteredTasks = useMemo(() => {
    if (!search.trim()) {
      return tasksQuery.data ?? [];
    }
    const query = search.toLowerCase();
    return (tasksQuery.data ?? []).filter((task) => {
      return [
        task.customer_name,
        task.area,
        task.task_description,
        task.task_type,
        task.qr_code,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }, [tasksQuery.data, search]);

  const handleReorderTasks = useCallback(
    async ({
      customer,
      area,
      tasks,
    }: {
      customer: string;
      area: string;
      tasks: AreaTask[];
    }) => {
      const key = `${customer}::${area}`;
      setPendingReorders((prev) => ({
        ...prev,
        [key]: tasks,
      }));
      try {
        await reorderAreaTasks({ customer, area, tasks });
        setPendingReorders((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        queryClient.invalidateQueries({ queryKey: ["area_tasks"] });
      } catch (error) {
        console.error(error);
        toast({
          title: "Could not reorder tasks",
          description:
            "Please try again or contact support if the issue persists.",
          variant: "destructive",
        });
        setPendingReorders((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [queryClient, toast],
  );

  const tasksWithPendingOrder = useMemo(() => {
    if (!Object.keys(pendingReorders).length) return filteredTasks;

    const processedAreas = new Set<string>();
    const result: AreaTask[] = [];

    filteredTasks.forEach((task) => {
      const key = `${task.customer_name?.trim() || "Unassigned Customer"}::${task.area?.trim() || "Unassigned Area"}`;
      const override = pendingReorders[key];

      if (override && !processedAreas.has(key)) {
        result.push(...override);
        processedAreas.add(key);
      } else if (!override) {
        result.push(task);
      }
    });

    return result;
  }, [filteredTasks, pendingReorders]);

  const customerNames = useMemo(() => {
    const set = new Set<string>();
    customersQuery.data?.forEach((customer) => {
      const trimmed = customer.name?.trim();
      if (trimmed) {
        set.add(trimmed);
      }
    });
    if (createCustomerMutation.isPending) {
      const pendingName = newCustomerName.trim();
      if (pendingName) {
        set.add(pendingName);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customersQuery.data, createCustomerMutation.isPending, newCustomerName]);

  const extraCustomers = useMemo(() => {
    if (!customerNames.length) return [];
    const trimmedSearch = search.trim().toLowerCase();
    if (!trimmedSearch) return customerNames;
    return customerNames.filter((name) =>
      name.toLowerCase().includes(trimmedSearch),
    );
  }, [customerNames, search]);

  const openCreateSheet = useCallback(
    (prefill?: { customer: string; area: string }) => {
      setSheetMode("create");
      setEditingTask(null);
      setPrefillData({
        customer_name: prefill?.customer ?? "",
        area: prefill?.area ?? "",
      });
      setSheetOpen(true);
    },
    [],
  );

  const openEditSheet = useCallback((task: AreaTask) => {
    setSheetMode("edit");
    setEditingTask(task);
    setPrefillData({});
    setSheetOpen(true);
  }, []);

  const handleSubmit = async (values: AreaTaskFormValues) => {
    if (sheetMode === "create") {
      await createMutation.mutateAsync({
        customer_name: values.customer_name,
        area: values.area,
        task_description: values.task_description,
        task_type: values.task_type,
        qr_code: values.qr_code,
        active: values.active,
      });
    } else if (editingTask) {
      await updateMutation.mutateAsync({ id: editingTask.id, values });
    }
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id);
  };

  const handleCustomerDialogChange = useCallback((open: boolean) => {
    setAddCustomerOpen(open);
    if (!open) {
      setNewCustomerName("");
    }
  }, []);

  const handleCreateCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newCustomerName.trim();
    if (!trimmed || createCustomerMutation.isPending) return;
    await createCustomerMutation.mutateAsync(trimmed);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-gray-100 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-[#00339B]">
              Area Tasks
            </h1>
            <p className="text-sm text-gray-500">
              Browse tasks per customer and area, then update as needed.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2">
              <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <Label htmlFor="area-task-search" className="sr-only">
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
          </div>
        </div>
      </div>

      {tasksQuery.isLoading || !expandedInitialized ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-[#00339B]" />
            <p className="text-sm text-gray-500">Loading tasks...</p>
          </div>
        </div>
      ) : tasksQuery.isError ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-8 text-center">
          <h2 className="text-lg font-semibold text-rose-600">
            Unable to load tasks
          </h2>
          <p className="mt-2 text-sm text-rose-500">
            Please refresh the page or try again later.
          </p>
        </div>
      ) : (
        <AreaTasksTree
          tasks={tasksWithPendingOrder}
          expandedNodes={expandedNodes}
          onToggleNode={(nodeId) =>
            setExpandedNodes((prev) => ({
              ...prev,
              [nodeId]: !prev[nodeId],
            }))
          }
          onEditTask={(task) => openEditSheet(task)}
          onDeleteTask={setPendingDelete}
          onCreateTask={({ customer, area }) => {
            setAddTaskOpen({ customer, area })
            setNewTaskDescription("")
          }}
          onReorderTasks={handleReorderTasks}
          extraCustomers={extraCustomers}
          onAddCustomer={() => setAddCustomerOpen(true)}
          onAddArea={({ customer }) => {
            const matched = customersQuery.data?.find(c => (c.name?.trim() || '') === customer)
            if (matched?.id) {
              setAddAreaOpen({ customerId: matched.id, customerName: matched.name || customer })
            } else {
              // If we cannot find by name, ask to create the customer first
              setAddCustomerOpen(true)
              setNewCustomerName(customer)
            }
          }}
          extraAreasByCustomer={extraAreasByCustomer}
        />
      )}

      <Dialog open={addCustomerOpen} onOpenChange={handleCustomerDialogChange}>
        <DialogContent className="rounded-[28px] border-0 bg-white/95 p-8 shadow-[0_24px_60px_rgba(0,23,71,0.12)] backdrop-blur">
          <DialogHeader className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00339B]/10">
                <UserPlus className="h-6 w-6 text-[#00339B]" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-semibold text-[#00339B]">
                  Add Customer
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-500">
                  Create a customer entry so you can assign areas and tasks to
                  it.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={handleCreateCustomer} className="space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="new-customer-name"
                className="text-sm font-semibold text-gray-700"
              >
                Customer name
              </Label>
              <Input
                id="new-customer-name"
                value={newCustomerName}
                onChange={(event) => setNewCustomerName(event.target.value)}
                placeholder="e.g. Avtrade"
                autoFocus
                className="rounded-2xl border-gray-200 bg-gray-50/70 px-4 py-2 text-sm font-medium text-gray-700 focus-visible:ring-[#00339B]"
              />
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-gray-200 text-gray-600 hover:bg-gray-100"
                onClick={() => handleCustomerDialogChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-full bg-[#00339B] px-6 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(0,51,155,0.18)] transition hover:bg-[#00297a]"
                disabled={
                  !newCustomerName.trim() || createCustomerMutation.isPending
                }
              >
                {createCustomerMutation.isPending ? "Adding…" : "Add customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addAreaOpen} onOpenChange={(open) => { if (!open) { setAddAreaOpen(null); setNewAreaName('') }}}>
        <DialogContent className="rounded-[28px] border-0 bg-white/95 p-8 shadow-[0_24px_60px_rgba(0,23,71,0.12)] backdrop-blur">
          <DialogHeader className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00339B]/10">
                <Search className="h-6 w-6 text-[#00339B]" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-semibold text-[#00339B]">
                  Add Area
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-500">
                  Create a new area under {addAreaOpen?.customerName}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!addAreaOpen) return; createAreaMutation.mutate({ customerId: addAreaOpen.customerId, name: newAreaName }) }} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="new-area-name" className="text-sm font-semibold text-gray-700">Area name</Label>
              <Input id="new-area-name" value={newAreaName} onChange={(e) => setNewAreaName(e.target.value)} placeholder="e.g. Reception" autoFocus className="rounded-2xl border-gray-200 bg-gray-50/70 px-4 py-2 text-sm font-medium text-gray-700 focus-visible:ring-[#00339B]" />
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button type="button" variant="outline" className="rounded-full border-gray-200 text-gray-600 hover:bg-gray-100" onClick={() => setAddAreaOpen(null)}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-full bg-[#00339B] px-6 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(0,51,155,0.18)] transition hover:bg-[#00297a]" disabled={!newAreaName.trim() || createAreaMutation.isPending}>
                {createAreaMutation.isPending ? 'Adding…' : 'Add area'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Task Dialog - minimal, rounded, same style as Add Area */}
      <Dialog open={!!addTaskOpen} onOpenChange={(open) => { if (!open) { setAddTaskOpen(null); setNewTaskDescription('') }}}>
        <DialogContent className="rounded-[28px] border-0 bg-white/95 p-8 shadow-[0_24px_60px_rgba(0,23,71,0.12)] backdrop-blur">
          <DialogHeader className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00339B]/10">
                <Search className="h-6 w-6 text-[#00339B]" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-semibold text-[#00339B]">
                  Add Task
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-500">
                  {addTaskOpen ? `Create a new task under ${addTaskOpen.customer} • ${addTaskOpen.area}.` : 'Create a new task.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!addTaskOpen) return;
              createMutation.mutate({
                customer_name: addTaskOpen.customer,
                area: addTaskOpen.area,
                task_description: newTaskDescription,
                active: true,
              })
            }}
            className="space-y-6"
          >
            <div className="space-y-2">
              <Label htmlFor="new-task-desc" className="text-sm font-semibold text-gray-700">Task description</Label>
              <Input
                id="new-task-desc"
                value={newTaskDescription}
                onChange={(e) => setNewTaskDescription(e.target.value)}
                placeholder="e.g. Vacuum and mop"
                autoFocus
                className="rounded-2xl border-gray-200 bg-gray-50/70 px-4 py-2 text-sm font-medium text-gray-700 focus-visible:ring-[#00339B]"
              />
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-gray-200 text-gray-600 hover:bg-gray-100"
                onClick={() => setAddTaskOpen(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-full bg-[#00339B] px-6 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(0,51,155,0.18)] transition hover:bg-[#00297a]"
                disabled={!newTaskDescription.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? 'Adding…' : 'Add task'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-xl overflow-y-auto border-0 bg-gradient-to-b from-white via-[#f5f7ff] to-white shadow-[0_20px_60px_rgba(0,23,71,0.12)]"
        >
          <SheetHeader className="space-y-3">
            <SheetTitle className="text-3xl font-semibold text-[#00339B]">
              {sheetMode === "create" ? "Add Task" : "Edit Task"}
            </SheetTitle>
            <SheetDescription className="text-base text-gray-500">
              {sheetMode === "create"
                ? "Add a new task to a specific customer area."
                : "Update the details for this task."}
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
            {sheetMode === "edit" && editingTask && (
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

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent className="rounded-3xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The task will be permanently removed
              from the area.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className={cn(
                "rounded-full bg-rose-600 hover:bg-rose-700",
                deleteMutation.isPending && "opacity-80",
              )}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
