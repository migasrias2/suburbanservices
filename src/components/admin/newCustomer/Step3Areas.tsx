import React, { useState } from 'react'
import { WizardShell } from './WizardShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Trash2 } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { AreaType } from '@/services/qrService'
import { createAreaForCustomer, describeError, listPresets, type AreaPreset } from '@/services/customerOnboardingService'
import type { WizardAreaInput, WizardState } from './types'
import { useEffect } from 'react'

interface Step3Props {
  state: WizardState
  totalSteps: number
  onUpdate: (patch: Partial<WizardState>) => void
  onBack: () => void
  onNext: () => void
}

const AREA_TYPES: { value: AreaType; label: string }[] = [
  { value: 'BATHROOMS_ABLUTIONS', label: 'Bathrooms / Ablutions' },
  { value: 'KITCHEN_CANTEEN', label: 'Kitchen / Canteen' },
  { value: 'ADMIN_OFFICE', label: 'Office' },
  { value: 'RECEPTION_COMMON', label: 'Reception / Common' },
  { value: 'WAREHOUSE_INDUSTRIAL', label: 'Warehouse / Industrial' },
  { value: 'GENERAL_AREAS', label: 'General areas' },
  { value: 'OPS_SITE_INSPECTION', label: 'Ops inspection' },
]

export const Step3Areas: React.FC<Step3Props> = ({ state, totalSteps, onUpdate, onBack, onNext }) => {
  const { toast } = useToast()
  const [areas, setAreas] = useState<WizardAreaInput[]>(state.areas ?? [])
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AreaType>('BATHROOMS_ABLUTIONS')
  const [isWorking, setIsWorking] = useState(false)
  const [presets, setPresets] = useState<AreaPreset[]>([])

  useEffect(() => {
    listPresets()
      .then(setPresets)
      .catch((err) => console.warn('Failed to load presets', err))
  }, [])

  const addArea = () => {
    if (!newName.trim()) return
    setAreas((prev) => [...prev, { name: newName.trim(), type: newType }])
    setNewName('')
  }

  const removeArea = (idx: number) => {
    setAreas((prev) => prev.filter((_, i) => i !== idx))
  }

  const applyPreset = (preset: AreaPreset) => {
    setAreas(preset.items)
  }

  const handleContinue = async () => {
    if (!state.customerId || !state.customerName) {
      toast({ title: 'Missing customer', variant: 'destructive' })
      return
    }
    setIsWorking(true)
    try {
      for (const area of areas) {
        await createAreaForCustomer({
          customerId: state.customerId,
          customerName: state.customerName,
          area,
        })
      }
      onUpdate({ areas })
      onNext()
    } catch (err) {
      console.error('Step3 save failed', err)
      toast({
        title: 'Could not save areas',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsWorking(false)
    }
  }

  const labelForType = (t: AreaType) => AREA_TYPES.find((x) => x.value === t)?.label ?? t

  return (
    <WizardShell
      step={3}
      totalSteps={totalSteps}
      title="What areas do they have?"
      subtitle="Add each area cleaners will scan. We'll auto-fill the task list for each one."
      onBack={onBack}
      onNext={handleContinue}
      isWorking={isWorking}
      nextLabel={areas.length === 0 ? 'Skip for now' : 'Continue'}
    >
      <div className="space-y-6">
        {presets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-gray-400">Presets</span>
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {areas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">
              No areas yet. Pick a preset or add one below.
            </div>
          ) : (
            areas.map((area, idx) => (
              <div
                key={`${area.name}-${idx}`}
                className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
              >
                <div>
                  <div className="text-base font-medium text-gray-900">{area.name}</div>
                  <div className="text-xs text-gray-500">{labelForType(area.type)}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeArea(idx)}
                  className="h-8 w-8 rounded-full p-0 text-gray-400 hover:bg-white hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Area name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Main Bathroom"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addArea()
                  }
                }}
                className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Type</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-between rounded-2xl border-gray-200 bg-gray-50/70 px-4 text-left text-gray-700"
                  >
                    {labelForType(newType)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] rounded-2xl border border-gray-100 p-1.5">
                  {AREA_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setNewType(t.value)}
                      className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${
                        newType === t.value ? 'bg-[#00339B] text-white' : 'text-gray-700 hover:bg-blue-50/60'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <Button
            onClick={addArea}
            disabled={!newName.trim()}
            className="w-full rounded-full bg-[#00339B] py-5 text-white hover:bg-[#002d7a] disabled:bg-gray-200 disabled:text-gray-400"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add area
          </Button>
        </div>
      </div>
    </WizardShell>
  )
}
