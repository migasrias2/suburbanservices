/**
 * Fake camera hardware for scanner tests: MediaStreamTrack, MediaStream,
 * navigator.mediaDevices and the <video> frame clock.
 *
 * getUserMedia follows a script, one step per call:
 *   'ok'     a stream whose frames arrive
 *   'black'  a stream that opens but never delivers a frame
 *   'hang'   a call that only settles when the test calls `settlePending()`
 *   { error: 'NotAllowedError' } and so on: a rejection with that name
 * Once the script is used up every call is 'ok'.
 */

export type GumStep = 'ok' | 'black' | 'hang' | { error: string }

export interface FakeDevice {
  deviceId: string
  label: string
}

type Listener = () => void

export class FakeTrack {
  readonly kind = 'video'
  readyState: 'live' | 'ended' = 'live'
  muted = false
  stoppedAt: number | null = null
  applied: MediaTrackConstraints[] = []
  private listeners = new Map<string, Set<Listener>>()

  constructor(
    readonly label: string,
    readonly deviceId: string,
    readonly capabilities: Record<string, unknown> = {},
  ) {}

  stop(): void {
    if (this.readyState === 'ended') return
    this.readyState = 'ended'
    this.stoppedAt = Date.now()
  }

  getSettings(): MediaTrackSettings {
    return { deviceId: this.deviceId, width: 1280, height: 720, frameRate: 30 }
  }

  getCapabilities(): Record<string, unknown> {
    return this.capabilities
  }

  async applyConstraints(constraints: MediaTrackConstraints): Promise<void> {
    this.applied.push(constraints)
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** The camera dies under us (another app took it, the OS evicted it). */
  end(): void {
    this.readyState = 'ended'
    this.listeners.get('ended')?.forEach((listener) => listener())
  }
}

export class FakeStream {
  constructor(
    readonly track: FakeTrack,
    public flowing: boolean,
  ) {}

  getTracks(): FakeTrack[] {
    return [this.track]
  }

  getVideoTracks(): FakeTrack[] {
    return [this.track]
  }

  get live(): boolean {
    return this.track.readyState === 'live'
  }
}

interface Pending {
  resolve: (stream: FakeStream) => void
  stream: FakeStream
}

export class FakeMediaDevices {
  script: GumStep[] = []
  calls: MediaStreamConstraints[] = []
  callTimes: number[] = []
  streams: FakeStream[] = []
  devices: FakeDevice[]
  /** Labels are hidden until a stream has been granted, as in real browsers. */
  labelsBeforeGrant = false
  capabilities: Record<string, unknown> = {}
  private granted = false
  private pending: Pending[] = []
  private maxLive = 0

  constructor(devices: FakeDevice[] = [{ deviceId: 'cam-0', label: 'camera 0, facing back' }]) {
    this.devices = devices
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    const showLabels = this.granted || this.labelsBeforeGrant
    return this.devices.map(
      (device) =>
        ({
          kind: 'videoinput',
          deviceId: device.deviceId,
          label: showLabels ? device.label : '',
          groupId: '',
          toJSON: () => ({}),
        }) as MediaDeviceInfo,
    )
  }

  getUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    this.calls.push(constraints)
    this.callTimes.push(Date.now())
    const step = this.script.shift() ?? 'ok'
    if (typeof step === 'object') {
      const error = new Error(step.error)
      error.name = step.error
      return Promise.reject(error)
    }
    const stream = this.makeStream(constraints, step !== 'black')
    if (step === 'hang') {
      return new Promise<MediaStream>((resolve) => {
        this.pending.push({ resolve: (s) => resolve(s as unknown as MediaStream), stream })
      })
    }
    return Promise.resolve(this.deliver(stream))
  }

  /** Let every hanging getUserMedia call resolve with its stream. */
  settlePending(): void {
    const pending = this.pending
    this.pending = []
    pending.forEach(({ resolve, stream }) => resolve(this.deliver(stream) as unknown as FakeStream))
  }

  /** When the i-th delivered stream was stopped (Date.now, so fake timers move it). */
  stopTimeOf(index: number): number {
    const stoppedAt = this.streams[index]?.track.stoppedAt
    if (stoppedAt == null) throw new Error(`stream ${index} was never stopped`)
    return stoppedAt
  }

  get liveStreams(): FakeStream[] {
    return this.streams.filter((stream) => stream.live)
  }

  /** The most streams that were ever live at the same moment. */
  get maxSimultaneousLive(): number {
    return Math.max(this.maxLive, this.liveStreams.length)
  }

  private makeStream(constraints: MediaStreamConstraints, flowing: boolean): FakeStream {
    const video = (constraints.video ?? {}) as MediaTrackConstraints
    const wanted = (video.deviceId as ConstrainDOMStringParameters | undefined)?.exact as string | undefined
    // Like Chrome: an exact deviceId wins; facingMode 'environment' takes the
    // first back camera in enumeration order; otherwise the first camera.
    const device =
      this.devices.find((d) => d.deviceId === wanted) ??
      (video.facingMode ? this.devices.find((d) => /back/i.test(d.label)) : undefined) ??
      this.devices[0]
    const track = new FakeTrack(device?.label ?? '', device?.deviceId ?? 'cam-x', this.capabilities)
    return new FakeStream(track, flowing)
  }

  private deliver(stream: FakeStream): MediaStream {
    this.granted = true
    this.maxLive = Math.max(this.maxLive, this.liveStreams.length + 1)
    this.streams.push(stream)
    return stream as unknown as MediaStream
  }
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Give every <video> a frame clock: requestVideoFrameCallback fires ~16 ms
 * later while its srcObject is a live, flowing FakeStream. play/load/pause are
 * stubbed because jsdom does not implement media playback. Returns the undo.
 */
export const installFakeVideo = (): (() => void) => {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  const videoProto = HTMLVideoElement.prototype as unknown as Record<string, unknown>
  const saved = {
    play: proto.play,
    load: proto.load,
    pause: proto.pause,
    rvfc: videoProto.requestVideoFrameCallback,
    cvfc: videoProto.cancelVideoFrameCallback,
    srcObject: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject'),
  }
  const sources = new WeakMap<HTMLMediaElement, unknown>()
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return sources.get(this) ?? null
    },
    set(this: HTMLMediaElement, value: unknown) {
      sources.set(this, value)
    },
  })
  proto.play = function play() {
    return Promise.resolve()
  }
  proto.load = function load() {}
  proto.pause = function pause() {}
  videoProto.requestVideoFrameCallback = function requestVideoFrameCallback(this: FrameVideo, callback: () => void) {
    return window.setTimeout(() => {
      const stream = this.srcObject as unknown as FakeStream | null
      if (stream instanceof FakeStream && stream.live && stream.flowing) callback()
    }, 16)
  }
  videoProto.cancelVideoFrameCallback = function cancelVideoFrameCallback(handle: number) {
    window.clearTimeout(handle)
  }
  return () => {
    proto.play = saved.play
    proto.load = saved.load
    proto.pause = saved.pause
    videoProto.requestVideoFrameCallback = saved.rvfc
    videoProto.cancelVideoFrameCallback = saved.cvfc
    if (saved.srcObject) Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', saved.srcObject)
    else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).srcObject
  }
}

/** Put the fake devices on navigator; returns the undo. */
export const installFakeMediaDevices = (fake: FakeMediaDevices): (() => void) => {
  const saved = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: fake })
  return () => {
    if (saved) Object.defineProperty(navigator, 'mediaDevices', saved)
    else delete (navigator as unknown as Record<string, unknown>).mediaDevices
  }
}

/** Make navigator.permissions.query({name:'camera'}) answer `state`; returns the undo. */
export const installCameraPermission = (state: PermissionState | 'unsupported'): (() => void) => {
  const saved = Object.getOwnPropertyDescriptor(navigator, 'permissions')
  const value =
    state === 'unsupported'
      ? undefined
      : { query: async () => ({ state, onchange: null }) as unknown as PermissionStatus }
  Object.defineProperty(navigator, 'permissions', { configurable: true, value })
  return () => {
    if (saved) Object.defineProperty(navigator, 'permissions', saved)
    else delete (navigator as unknown as Record<string, unknown>).permissions
  }
}

/** Pretend the page is hidden or visible and fire visibilitychange. */
export const setPageVisibility = (state: 'hidden' | 'visible'): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}
