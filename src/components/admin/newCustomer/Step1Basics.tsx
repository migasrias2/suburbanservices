import React, { useState } from 'react'
import { WizardShell } from './WizardShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { createCustomerBasics, describeError } from '@/services/customerOnboardingService'
import type { WizardState } from './types'

interface Step1Props {
  state: WizardState
  totalSteps: number
  onUpdate: (patch: Partial<WizardState>) => void
  onNext: () => void
}

export const Step1Basics: React.FC<Step1Props> = ({ state, totalSteps, onUpdate, onNext }) => {
  const { toast } = useToast()
  const [name, setName] = useState(state.customerName ?? '')
  const [displayName, setDisplayName] = useState(state.displayName ?? '')
  const [address, setAddress] = useState(state.address ?? '')
  const [contactEmail, setContactEmail] = useState(state.contactEmail ?? '')
  const [contactPhone, setContactPhone] = useState(state.contactPhone ?? '')
  const [isWorking, setIsWorking] = useState(false)

  const canContinue = name.trim().length > 0

  const handleContinue = async () => {
    if (!canContinue) return
    setIsWorking(true)
    try {
      const customer = await createCustomerBasics({
        name: name.trim(),
        displayName: displayName.trim() || undefined,
        address: address.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
      })
      const resolvedName = customer.display_name || customer.customer_name || customer.name || name.trim()
      onUpdate({
        customerId: customer.id,
        customerName: resolvedName,
        displayName: displayName.trim() || resolvedName,
        address: address.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
      })
      onNext()
    } catch (err) {
      console.error(err)
      toast({
        title: 'Could not create client',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <WizardShell
      step={1}
      totalSteps={totalSteps}
      title="New client"
      subtitle="Let's start with the basics."
      onNext={handleContinue}
      nextDisabled={!canContinue}
      isWorking={isWorking}
      hideBack
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700">Client name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Avtrade"
            autoFocus
            className="h-14 rounded-2xl border-gray-200 bg-gray-50/70 px-5 text-lg text-gray-900 placeholder:text-gray-400"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700">Display name <span className="text-gray-400">(optional)</span></Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What managers and cleaners see"
            className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-5 text-base text-gray-900 placeholder:text-gray-400"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700">Address <span className="text-gray-400">(optional)</span></Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Site address"
            className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-5 text-base text-gray-900 placeholder:text-gray-400"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Contact email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="optional"
              className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-5 text-base text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Contact phone</Label>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="optional"
              className="h-12 rounded-2xl border-gray-200 bg-gray-50/70 px-5 text-base text-gray-900 placeholder:text-gray-400"
            />
          </div>
        </div>
      </div>
    </WizardShell>
  )
}
