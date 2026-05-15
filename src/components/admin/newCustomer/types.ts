import type { AreaType, ManualQRCodeResult } from '@/services/qrService'
import type { CreatedManager } from '@/services/customerOnboardingService'

export type WizardAreaInput = {
  name: string
  type: AreaType
  tasks?: string[]
}

export type WizardQrItem = {
  label: string
  qrType: 'CLOCK_IN' | 'CLOCK_OUT' | 'FEEDBACK' | 'AREA'
  dataUrl: string
  storageUrl: string
  payloadId: string
}

export type WizardState = {
  step: 1 | 2 | 3 | 4 | 5
  customerId?: string
  customerName?: string
  displayName?: string
  address?: string
  contactEmail?: string
  contactPhone?: string
  selectedManagerIds: string[]
  createdManagers: CreatedManager[]
  areas: WizardAreaInput[]
  qrPack: WizardQrItem[]
}

export const INITIAL_STATE: WizardState = {
  step: 1,
  selectedManagerIds: [],
  createdManagers: [],
  areas: [],
  qrPack: [],
}

export const WIZARD_STORAGE_KEY = 'wizard:newCustomer:v1'

export function loadWizardState(): WizardState {
  if (typeof window === 'undefined') return INITIAL_STATE
  try {
    const raw = localStorage.getItem(WIZARD_STORAGE_KEY)
    if (!raw) return INITIAL_STATE
    const parsed = JSON.parse(raw) as Partial<WizardState>
    return { ...INITIAL_STATE, ...parsed }
  } catch {
    return INITIAL_STATE
  }
}

export function saveWizardState(state: WizardState) {
  if (typeof window === 'undefined') return
  localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state))
}

export function clearWizardState() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(WIZARD_STORAGE_KEY)
}

export type ManualQrResultLite = Pick<ManualQRCodeResult, 'dataUrl' | 'storageUrl' | 'qrData'>
