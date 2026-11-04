/**
 * Which lens to scan with.
 *
 * Android: Chrome labels cameras "camera <n>, facing back|front" (before June
 * 2025: "camera2 <n>, …"). n = 0 is the first back camera in Android's list,
 * which is the main lens; plain facingMode 'environment' sometimes opens the
 * ultra-wide on Samsungs, which cannot focus at arm's length.
 *
 * iPhone: labels are translated and the "virtual" back cameras switch lenses
 * by themselves, so we only ever ask for facingMode.
 *
 * A lens is remembered only once it has actually decoded a code, never merely
 * because it opened (research 03 §2, plan §3.5).
 */
import { pickScanCamera, type CameraOption } from '@/lib/cameraChoice'

export type { CameraOption }

export type LensRung = 'remembered' | 'android-main' | 'back-label' | 'facing-mode'

export interface LensChoice {
  /** null: open with facingMode and let the browser pick. */
  deviceId: string | null
  rung: LensRung
  label: string | null
}

export const DECODED_CAMERA_STORAGE_KEY = 'qrScanV2DecodedCameraId'

const ANDROID_MAIN_BACK = /^camera2? 0, facing back$/i
const FRONT = /front|user|selfie|facetime/i

export const isAndroidMainLens = (label: string): boolean => ANDROID_MAIN_BACK.test(label.trim())

const FACING_MODE: LensChoice = { deviceId: null, rung: 'facing-mode', label: null }

export const chooseLens = (
  cameras: CameraOption[],
  options: { isIOS: boolean; remembered?: string | null },
): LensChoice => {
  if (options.isIOS) return FACING_MODE
  const remembered = options.remembered ? cameras.find((camera) => camera.id === options.remembered) : undefined
  if (remembered) return { deviceId: remembered.id, rung: 'remembered', label: remembered.label || null }

  const picked = pickScanCamera(cameras, null)
  const camera = picked ? cameras.find((c) => c.id === picked) : undefined
  if (!camera) return FACING_MODE
  return {
    deviceId: camera.id,
    rung: isAndroidMainLens(camera.label) ? 'android-main' : 'back-label',
    label: camera.label,
  }
}

/** The main Android lens, when labels are readable; null otherwise. */
export const findAndroidMainLens = (cameras: CameraOption[]): CameraOption | null =>
  cameras.find((camera) => isAndroidMainLens(camera.label)) ?? null

/**
 * The cameras "Switch camera" cycles through: every camera that isn't a front
 * one. Nothing on iPhone, and nothing while labels are unreadable (we can't
 * tell front from back, and offering the selfie camera helps nobody).
 */
export const switchableCameras = (cameras: CameraOption[], isIOS: boolean): CameraOption[] => {
  if (isIOS) return []
  if (cameras.some((camera) => !camera.label)) return []
  return cameras.filter((camera) => !FRONT.test(camera.label))
}

export const readDecodedCamera = (): string | null => {
  try {
    return localStorage.getItem(DECODED_CAMERA_STORAGE_KEY)
  } catch {
    return null
  }
}

export const rememberDecodedCamera = (deviceId: string): void => {
  try {
    localStorage.setItem(DECODED_CAMERA_STORAGE_KEY, deviceId)
  } catch {
    // Storage blocked or full: the lens still works now, it just isn't remembered.
  }
}
