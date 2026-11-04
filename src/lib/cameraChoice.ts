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
// Chrome on Android names cameras "camera2 <n>, facing back" (since 2025 just
// "camera <n>, facing back"); n = 0 is the main lens.
const ANDROID_MAIN_BACK = /^camera2? 0, facing back$/i

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

/** The camera the person last switched to, if storage can tell us. */
export const readRememberedCamera = (): string | null => {
  try {
    return localStorage.getItem(SCAN_CAMERA_STORAGE_KEY)
  } catch {
    return null
  }
}

export const rememberCamera = (id: string): void => {
  try {
    localStorage.setItem(SCAN_CAMERA_STORAGE_KEY, id)
  } catch {
    // Not remembering the choice is fine; it still applies now.
  }
}

const videoTrack = (video: HTMLVideoElement | null): MediaStreamTrack | null => {
  const stream = video?.srcObject
  if (typeof MediaStream === 'undefined' || !(stream instanceof MediaStream)) return null
  return stream.getVideoTracks()[0] ?? null
}

/** The camera the video is actually showing, whoever chose it. */
export const activeCameraId = (video: HTMLVideoElement | null): string | null =>
  videoTrack(video)?.getSettings?.().deviceId ?? null

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * qr-scanner's destroy() (through stop() and pause()) arms a 300 ms timer
 * that then stops whatever stream the <video> holds at that moment, even one
 * a newer scanner has just opened. So nothing reopens on the same video until
 * this long after a release. It must stay above 300 ms.
 */
export const REOPEN_GAP_MS = 400

interface ReleasableScanner {
  pause: (stopStreamImmediately?: boolean) => Promise<boolean>
  destroy: () => void
}

/** Stop the camera tracks now (the indicator goes off), then tear the scanner down. */
export const releaseScanner = async (scanner: ReleasableScanner): Promise<void> => {
  try {
    await scanner.pause(true)
  } catch {
    // Already torn down; destroy below is still safe.
  } finally {
    scanner.destroy()
  }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** Flags `seen.frame` when the browser presents a new frame; returns the undo. */
const watchForFrame = (video: FrameCallbackVideo, seen: { frame: boolean }): (() => void) => {
  if (typeof video.requestVideoFrameCallback !== 'function') return () => {}
  const handle = video.requestVideoFrameCallback(() => {
    seen.frame = true
  })
  return () => {
    if (!seen.frame) video.cancelVideoFrameCallback?.(handle)
  }
}

/**
 * Is the camera actually delivering frames? A phone can open the camera (the
 * indicator comes on, no error is raised) and still hand over nothing, which
 * shows as a black box. A frame counts as arrived when the browser's frame
 * callback fires, or, where that is missing or silent, when the video has a
 * size and its clock moves. Brightness is deliberately not checked: a dark
 * room is not a dead camera.
 */
export const framesAreFlowing = async (
  video: HTMLVideoElement | null,
  timeoutMs = 3000,
  pollMs = 150,
): Promise<boolean> => {
  if (!video) return false
  const seen = { frame: false }
  const stopWatching = watchForFrame(video as FrameCallbackVideo, seen)
  const deadline = Date.now() + timeoutMs
  let previousTime: number | null = null
  try {
    while (Date.now() < deadline) {
      if (seen.frame) return true
      const sized = video.readyState >= 2 && video.videoWidth > 0 && !videoTrack(video)?.muted
      if (sized) {
        const time = video.currentTime
        if (previousTime !== null && time > previousTime) return true
        previousTime = time
      }
      await sleep(pollMs)
    }
    return seen.frame
  } finally {
    stopWatching()
  }
}
