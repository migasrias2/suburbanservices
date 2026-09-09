import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { AreaTask } from '@/services/supabase'

const schema = z.object({
  customer_name: z.string().min(1, 'Customer name is required'),
  area: z.string().min(1, 'Area name is required'),
  task_description: z.string().min(1, 'Task description is required'),
  task_type: z.string().optional(),
  qr_code: z.string().optional(),
  active: z.boolean().default(true),
})

export type AreaTaskFormValues = z.infer<typeof schema>

export interface AreaTaskFormProps {
  defaultValues?: Partial<AreaTask>
  onSubmit: (values: AreaTaskFormValues) => Promise<void>
  submitting?: boolean
}

export const AreaTaskForm = ({ defaultValues, onSubmit, submitting }: AreaTaskFormProps) => {
  const form = useForm<AreaTaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_name: defaultValues?.customer_name ?? '',
      area: defaultValues?.area ?? '',
      task_description: defaultValues?.task_description ?? '',
      task_type: defaultValues?.task_type ?? '',
      qr_code: defaultValues?.qr_code ?? '',
      active: defaultValues?.active ?? true,
    },
  })

  useEffect(() => {
    form.reset({
      customer_name: defaultValues?.customer_name ?? '',
      area: defaultValues?.area ?? '',
      task_description: defaultValues?.task_description ?? '',
      task_type: defaultValues?.task_type ?? '',
      qr_code: defaultValues?.qr_code ?? '',
      active: defaultValues?.active ?? true,
    })
  }, [defaultValues, form])

  const submit = async (values: AreaTaskFormValues) => {
    await onSubmit({
      ...values,
      task_type: values.task_type?.trim() ? values.task_type : undefined,
      qr_code: values.qr_code?.trim() ? values.qr_code : undefined,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <FormField
          control={form.control}
          name="customer_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-foreground">Customer</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g. Adams"
                  {...field}
                  className="rounded-2xl border-border bg-muted/70 px-4 py-2 text-sm font-medium text-foreground focus-visible:ring-ring"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="area"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-semibold text-foreground">Area</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Reception"
                    {...field}
                    className="rounded-2xl border-border bg-muted/70 px-4 py-2 text-sm font-medium text-foreground focus-visible:ring-ring"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="task_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-semibold text-foreground">Task Type</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Optional"
                    {...field}
                    className="rounded-2xl border-border bg-muted/70 px-4 py-2 text-sm font-medium text-foreground focus-visible:ring-ring"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="task_description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-foreground">Task Description</FormLabel>
              <FormControl>
                <Input
                  placeholder="What needs to be done"
                  {...field}
                  className="rounded-2xl border-border bg-muted/70 px-4 py-2 text-sm font-medium text-foreground focus-visible:ring-ring"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="qr_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-foreground">QR Code (optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="QR identifier"
                  {...field}
                  className="rounded-2xl border-border bg-muted/70 px-4 py-2 text-sm font-medium text-foreground focus-visible:ring-ring"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <div>
                  <FormLabel className="text-sm font-semibold text-foreground">Active</FormLabel>
                  <p className="text-xs text-muted-foreground">Inactive tasks stay in the list but are hidden from cleaners.</p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button
            type="submit"
            className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground shadow-[0_12px_24px_rgba(0,51,155,0.25)] transition hover:bg-primary/90"
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Task'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

