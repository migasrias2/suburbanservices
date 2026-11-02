/**
 * Which camera to scan QR codes with.
 *
 * Asking the browser for "the back camera" is not enough on phones with
 * several back lenses. Samsung Galaxy phones list ultra-wide, telephoto and
 * macro lenses as back cameras too, and Chrome often opens one of those: the
 * picture shows up, but the lens cannot focus at arm's length, so the QR code
 * stays blurry and never decodes. The main lens is the one to use.
 */

export interface CameraOption {
  id: string
  label: string
}

export const SCAN_CAMERA_STORAGE_KEY = 'qrScanCameraId'

const FRONT = /front|user|selfie|facetime/i
const BACK = /back|rear|environment/i
const SPECIAL_LENS = /ultra|wide|tele|macro|depth|zoom|tof/i
// Chrome on Android names cameras "camera2 <n>, facing back"; n = 0 is the main lens.
const ANDROID_MAIN_BACK = /camera2 0\b.*facing back/i

/**
 * The camera to start with, or null to let the browser choose.
 * A camera the person picked themselves wins while it still exists.
 */
export const pickScanCamera = (cameras: CameraOption[], remembered?: string | null): string | null => {
  if (remembered && cameras.some((camera) => camera.id === remembered)) return remembered

  const androidMain = cameras.find((camera) => ANDROID_MAIN_BACK.test(camera.label))
  if (androidMain) return androidMain.id

  const plainBack = cameras.find(
    (camera) => BACK.test(camera.label) && !FRONT.test(camera.label) && !SPECIAL_LENS.test(camera.label),
  )
  return plainBack?.id ?? null
}

/** The camera after `currentId`, wrapping round; null when there is nothing to switch to. */
export const nextCameraId = (cameras: CameraOption[], currentId: string | null): string | null => {
  if (cameras.length < 2) return null
  const index = cameras.findIndex((camera) => camera.id === currentId)
  return cameras[(index + 1) % cameras.length].id
}

/**
 * Ask the camera to keep refocusing. Some Android phones open the stream with
 * focus fixed at a distance, which leaves a QR code at arm's length blurry.
 * Browsers that don't support it are left alone.
 */
const videoTrack = (video: HTMLVideoElement | null): MediaStreamTrack | null => {
  const stream = video?.srcObject
  if (typeof MediaStream === 'undefined' || !(stream instanceof MediaStream)) return null
  return stream.getVideoTracks()[0] ?? null
}

/** The camera the video is actually showing, whoever chose it. */
export const activeCameraId = (video: HTMLVideoElement | null): string | null =>
  videoTrack(video)?.getSettings?.().deviceId ?? null

export const applyContinuousFocus = async (video: HTMLVideoElement | null): Promise<void> => {
  const track = videoTrack(video)
  if (!track?.getCapabilities) return
  try {
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[] }
    if (capabilities.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
    }
  } catch {
    // Focus is a nice-to-have; scanning still works without it.
  }
}
