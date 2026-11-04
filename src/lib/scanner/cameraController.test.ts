import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeMediaDevices, FakeStream, installFakeVideo } from '@/test/fakeMedia'
import {
  buildVideoConstraints,
  createCameraController,
  createReleaseClock,
  REOPEN_GAP_MS,
  type CameraController,
} from './cameraController'
import { createSerialQueue } from './serialQueue'

const devicesOf = (fake: FakeMediaDevices) => () => fake as unknown as MediaDevices

describe('buildVideoConstraints', () => {
  it('asks for the back camera with an ideal size, never min or exact sizes', () => {
    const c = buildVideoConstraints({})
    expect(c).toEqual({ facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } })
    expect(JSON.stringify(c)).not.toMatch(/"min"|"exact"/)
  })

  it('pins a chosen lens by exact deviceId, sizes still ideal', () => {
    expect(buildVideoConstraints({ deviceId: 'b0' })).toEqual({
      deviceId: { exact: 'b0' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    })
  })
})

describe('createCameraController', () => {
  let fake: FakeMediaDevices
  let video: HTMLVideoElement
  let undoVideo: () => void
  let controller: CameraController

  const make = (overrides: Partial<Parameters<typeof createCameraController>[1]> = {}) =>
    createCameraController(video, {
      mediaDevices: devicesOf(fake),
      queue: createSerialQueue(),
      releaseClock: createReleaseClock(),
      now: () => Date.now(),
      ...overrides,
    })

  beforeEach(() => {
    undoVideo = installFakeVideo()
    fake = new FakeMediaDevices([
      { deviceId: 'f1', label: 'camera 1, facing front' },
      { deviceId: 'b0', label: 'camera 0, facing back' },
    ])
    video = document.createElement('video')
    controller = make()
  })

  afterEach(() => {
    controller.dispose()
    undoVideo()
    vi.useRealTimers()
  })

  it('opens one stream, shows it muted and inline, and reports what opened', async () => {
    const opened = await controller.open({})
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].audio).toBe(false)
    expect(video.srcObject).toBe(fake.streams[0])
    expect(video.muted).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(opened).toMatchObject({ deviceId: 'b0', label: 'camera 0, facing back' })
  })

  it('stops the tracks the moment release() is called, not on a timer', async () => {
    await controller.open({ deviceId: 'b0' })
    const stream = fake.streams[0]
    controller.release()
    expect(stream.live).toBe(false)
    expect(video.srcObject).toBeNull()
  })

  it(`waits at least ${REOPEN_GAP_MS} ms after a release before opening again`, async () => {
    vi.useFakeTimers()
    await controller.open({})
    controller.release()
    const reopening = controller.open({})
    await vi.advanceTimersByTimeAsync(REOPEN_GAP_MS - 10)
    expect(fake.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(20)
    await reopening
    expect(fake.calls).toHaveLength(2)
    expect(fake.callTimes[1] - fake.stopTimeOf(0)).toBeGreaterThanOrEqual(REOPEN_GAP_MS)
  })

  it('keeps the gap across controllers: the camera is one device for the whole page', async () => {
    vi.useFakeTimers()
    const clock = createReleaseClock()
    const queue = createSerialQueue()
    const first = make({ releaseClock: clock, queue })
    await first.open({})
    first.dispose()
    const second = make({ releaseClock: clock, queue })
    const opening = second.open({})
    await vi.advanceTimersByTimeAsync(REOPEN_GAP_MS - 50)
    expect(fake.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    await opening
    expect(fake.calls).toHaveLength(2)
    second.dispose()
  })

  it('releases a stream that arrives after the open was cancelled', async () => {
    fake.script = ['hang']
    const opening = controller.open({})
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    controller.release()
    expect(await opening).toBeNull()
    fake.settlePending()
    await Promise.resolve()
    expect(fake.streams[0].live).toBe(false)
    expect(video.srcObject).toBeNull()
  })

  it('does not let a cancelled, still-hanging open block the next one', async () => {
    fake.script = ['hang']
    const first = controller.open({})
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    controller.release()
    const second = await controller.open({})
    expect(second).not.toBeNull()
    expect(await first).toBeNull()
    fake.settlePending()
    await Promise.resolve()
    expect(fake.liveStreams).toHaveLength(1)
  })

  it('never has two live streams: a second open releases the first before asking again', async () => {
    await controller.open({ deviceId: 'b0' })
    await controller.open({ deviceId: 'f1' })
    expect(fake.maxSimultaneousLive).toBe(1)
    expect(fake.liveStreams).toHaveLength(1)
    expect(fake.streams[0].live).toBe(false)
  })

  it('a later open wins over an earlier one still in flight', async () => {
    fake.script = ['hang']
    const first = controller.open({ deviceId: 'b0' })
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    const second = controller.open({ deviceId: 'f1' })
    fake.settlePending()
    expect(await first).toBeNull()
    expect(await second).toMatchObject({ deviceId: 'f1' })
    expect(fake.liveStreams).toHaveLength(1)
    expect(fake.maxSimultaneousLive).toBe(1)
  })

  it('passes getUserMedia errors through with their name', async () => {
    fake.script = [{ error: 'NotAllowedError' }]
    await expect(controller.open({})).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('returns null from open after dispose, and stops what it had', async () => {
    await controller.open({})
    controller.dispose()
    expect(fake.liveStreams).toHaveLength(0)
    expect(await controller.open({})).toBeNull()
    expect(fake.calls).toHaveLength(1)
  })

  it('lists cameras without opening a stream', async () => {
    const cams = await controller.listCameras()
    expect(cams).toEqual([
      { id: 'f1', label: '' },
      { id: 'b0', label: '' },
    ])
    expect(fake.calls).toHaveLength(0)
  })

  describe('torch and zoom', () => {
    it('reports nothing supported when the track offers nothing', async () => {
      await controller.open({})
      expect(controller.capabilities()).toEqual({ torch: false, zoom: null })
      expect(await controller.setTorch(true)).toBe(false)
      expect(await controller.setZoom(2)).toBe(false)
      expect((fake.streams[0] as FakeStream).track.applied).toEqual([])
    })

    it('applies torch and zoom separately, never together, never focusMode', async () => {
      fake.capabilities = { torch: true, zoom: { min: 1, max: 4, step: 0.1 } }
      await controller.open({})
      expect(controller.capabilities()).toEqual({ torch: true, zoom: { min: 1, max: 4, step: 0.1 } })
      expect(await controller.setTorch(true)).toBe(true)
      expect(await controller.setZoom(2)).toBe(true)
      expect(await controller.setZoom(9)).toBe(true)
      const applied = fake.streams[0].track.applied
      expect(applied).toEqual([{ advanced: [{ torch: true }] }, { advanced: [{ zoom: 2 }] }, { advanced: [{ zoom: 4 }] }])
      expect(JSON.stringify(applied)).not.toMatch(/focusMode/)
    })
  })
})
