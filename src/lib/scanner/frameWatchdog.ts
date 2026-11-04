/**
 * Is the camera actually delivering frames?
 *
 * A phone can open the camera without error (the light comes on) and still
 * hand over nothing: a black box. A frame counts as arrived when the browser's
 * requestVideoFrameCallback fires, or, where that is missing, when the video
 * has a size and its clock moves. Brightness is never checked: a dark corridor
 * is not a dead camera (research 03 §4.2).
 */

export const FIRST_FRAME_TIMEOUT_MS = 3000
export const STALL_MS = 3000

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

const videoTrackOf = (video: HTMLVideoElement): MediaStreamTrack | null => {
  const stream = video.srcObject as MediaStream | null
  if (!stream || typeof (stream as MediaStream).getVideoTracks !== 'function') return null
  return stream.getVideoTracks()[0] ?? null
}

/** Calls `onFrame` for every presented frame until the returned undo runs. */
const subscribeFrames = (video: FrameVideo, onFrame: () => void, pollMs: number): (() => void) => {
  let stopped = false
  if (typeof video.requestVideoFrameCallback === 'function') {
    let handle = 0
    const next = () => {
      if (stopped) return
      handle = video.requestVideoFrameCallback!(() => {
        if (stopped) return
        onFrame()
        next()
      })
    }
    next()
    return () => {
      stopped = true
      video.cancelVideoFrameCallback?.(handle)
    }
  }
  // No frame callbacks (old Firefox): the clock moving is a frame.
  let previous: number | null = null
  const timer = setInterval(() => {
    if (stopped) return
    const sized = video.readyState >= 2 && video.videoWidth > 0 && !videoTrackOf(video)?.muted
    if (!sized) return
    const time = video.currentTime
    if (previous !== null && time > previous) onFrame()
    previous = time
  }, pollMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/** Calls `onEnded` once if the video's track ends; returns the undo. */
const onTrackEnded = (video: HTMLVideoElement, onEnded: () => void): (() => void) => {
  const track = videoTrackOf(video)
  if (!track?.addEventListener) return () => {}
  const listener = () => onEnded()
  track.addEventListener('ended', listener)
  return () => track.removeEventListener('ended', listener)
}

export interface WaitForFramesOptions {
  timeoutMs?: number
  pollMs?: number
  signal?: AbortSignal
}

/** True once a frame arrives; false on timeout, abort or the track ending. */
export const waitForFrames = (video: HTMLVideoElement, options: WaitForFramesOptions = {}): Promise<boolean> => {
  const { timeoutMs = FIRST_FRAME_TIMEOUT_MS, pollMs = 100, signal } = options
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const cleanups: (() => void)[] = []
    const finish = (result: boolean) => {
      cleanups.forEach((undo) => undo())
      cleanups.length = 0
      resolve(result)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    cleanups.push(() => clearTimeout(timer))
    cleanups.push(subscribeFrames(video as FrameVideo, () => finish(true), pollMs))
    cleanups.push(onTrackEnded(video, () => finish(false)))
    if (signal) {
      const onAbort = () => finish(false)
      signal.addEventListener('abort', onAbort)
      cleanups.push(() => signal.removeEventListener('abort', onAbort))
    }
  })
}

export interface WatchFramesOptions {
  stallMs?: number
  checkMs?: number
  pollMs?: number
  onStall: () => void
}

/**
 * While scanning: calls `onStall` once if no frame arrives for `stallMs`, or
 * at once if the track ends (the camera was taken away). Returns the stop.
 */
export const watchFrames = (video: HTMLVideoElement, options: WatchFramesOptions): (() => void) => {
  const { stallMs = STALL_MS, checkMs = Math.min(500, stallMs / 4), pollMs = 100, onStall } = options
  let lastFrameAt = Date.now()
  let done = false
  const cleanups: (() => void)[] = []
  const stop = () => {
    done = true
    cleanups.forEach((undo) => undo())
    cleanups.length = 0
  }
  const stall = () => {
    if (done) return
    stop()
    onStall()
  }
  cleanups.push(subscribeFrames(video as FrameVideo, () => (lastFrameAt = Date.now()), pollMs))
  cleanups.push(onTrackEnded(video, stall))
  const timer = setInterval(() => {
    if (Date.now() - lastFrameAt > stallMs) stall()
  }, checkMs)
  cleanups.push(() => clearInterval(timer))
  return stop
}
