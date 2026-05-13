import React, { useState } from 'react'
import { WizardShell } from './WizardShell'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Download, QrCode } from 'lucide-react'
import { generateCustomerQrPack, describeError } from '@/services/customerOnboardingService'
import type { WizardState, WizardQrItem } from './types'

interface Step4Props {
  state: WizardState
  totalSteps: number
  onUpdate: (patch: Partial<WizardState>) => void
  onBack: () => void
  onNext: () => void
}

export const Step4QRs: React.FC<Step4Props> = ({ state, totalSteps, onUpdate, onBack, onNext }) => {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null)
  const qrPack = state.qrPack ?? []

  const handleGenerate = async () => {
    if (!state.customerId || !state.customerName) {
      toast({ title: 'Missing customer', variant: 'destructive' })
      return
    }
    setIsGenerating(true)
    try {
      const pack = await generateCustomerQrPack({
        customerId: state.customerId,
        customerName: state.customerName,
        areas: state.areas,
        onProgress: (current, total, label) => setProgress({ current, total, label }),
      })
      const lite: WizardQrItem[] = pack.map((p) => ({
        label: p.label,
        qrType: p.qrType,
        dataUrl: p.result.dataUrl,
        storageUrl: p.result.storageUrl,
        payloadId: p.result.qrData.id,
      }))
      onUpdate({ qrPack: lite })
      toast({ title: `Generated ${lite.length} QR codes` })
    } catch (err) {
      console.error('Step4 QR generation failed', err)
      toast({
        title: 'Could not generate QR codes',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsGenerating(false)
      setProgress(null)
    }
  }

  const downloadOne = (item: WizardQrItem) => {
    const link = document.createElement('a')
    link.download = `${(state.customerName ?? 'customer').replace(/\s+/g, '_').toLowerCase()}-${item.label.replace(/\s+/g, '_').toLowerCase()}.png`
    link.href = item.dataUrl
    link.click()
  }

  const downloadAll = () => {
    qrPack.forEach((item, idx) => {
      setTimeout(() => downloadOne(item), idx * 100)
    })
  }

  return (
    <WizardShell
      step={4}
      totalSteps={totalSteps}
      title="Print and stick"
      subtitle="Generate the QR pack — Clock In, Clock Out, Feedback, and one per area."
      onBack={onBack}
      onNext={onNext}
      hideNext={qrPack.length === 0}
      nextLabel="Finish"
    >
      <div className="space-y-6">
        {qrPack.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <QrCode className="h-7 w-7 text-gray-700" />
            </div>
            <p className="mb-2 text-base font-medium text-gray-900">
              Ready to generate {3 + state.areas.length} QR codes
            </p>
            <p className="mb-6 text-sm text-gray-500">
              Clock In · Clock Out · Feedback{state.areas.length > 0 && ` · ${state.areas.length} area${state.areas.length === 1 ? '' : 's'}`}
            </p>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="rounded-full bg-[#00339B] px-8 py-5 text-base font-medium text-white hover:bg-[#002d7a]"
            >
              {isGenerating
                ? progress
                  ? `${progress.current}/${progress.total} · ${progress.label}`
                  : 'Generating…'
                : 'Generate QR pack'}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {qrPack.map((item) => (
                <button
                  key={item.payloadId}
                  type="button"
                  onClick={() => downloadOne(item)}
                  className="group flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-[#00339B]"
                >
                  <img src={item.dataUrl} alt={item.label} className="h-32 w-32" />
                  <div className="mt-3 w-full text-center">
                    <div className="text-sm font-medium text-gray-900 truncate">{item.label}</div>
                    <div className="text-xs text-gray-400 group-hover:text-[#00339B]">
                      Click to download
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <Button
              onClick={downloadAll}
              variant="outline"
              className="w-full rounded-full border-gray-200 py-5 text-base text-gray-700 hover:bg-gray-50"
            >
              <Download className="mr-2 h-4 w-4" />
              Download all
            </Button>
          </>
        )}
      </div>
    </WizardShell>
  )
}
