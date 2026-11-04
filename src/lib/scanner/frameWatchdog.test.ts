import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeStream, FakeTrack, installFakeVideo } from '@/test/fakeMedia'
import { waitForFrames, watchFrames } from './frameWatchdog'

const streamOf = (flowing: boolean) => new FakeStream(new FakeTrack('camera 0, facing back', 'b0'), flowing)

/** A video with no requestVideoFrameCallback, whose clock the test moves by hand. */
const clockVideo = () => {
  const video = document.createElement('video') as HTMLVideoElement & { requestVideoFrameCallback?: unknown }
  Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined })
  let time = 0
  Object.defineProperty(video, 'currentTime', { get: () => time, configurable: true })
  Object.defineProperty(video, 'readyState', { get: () => 4, configurable: true })
  Object.defineProperty(video, 'videoWidth', { get: () => 1280, configurable: true })
  return { video, tick: () => (time += 0.033) }
}

describe('waitForFrames', () => {
  let undo: () => void
  beforeEach(() => {
    undo = installFakeVideo()
  })
  afterEach(() => {
    undo()
    vi.useRealTimers()
  })

  it('resolves true as soon as the browser presents a frame', async () => {
    const video = document.createElement('video')
    video.srcObject = streamOf(true) as unknown as MediaStream
    const started = Date.now()
    expect(await waitForFrames(video, { timeoutMs: 3000 })).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('resolves false after the timeout when the camera is open but black', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    video.srcObject = streamOf(false) as unknown as MediaStream
    const result = waitForFrames(video, { timeoutMs: 3000 })
    await vi.advanceTimersByTimeAsync(2900)
    let settled = false
    void result.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await result).toBe(false)
  })

  it('falls back to the video clock moving where frame callbacks are missing', async () => {
    vi.useFakeTimers()
    const { video, tick } = clockVideo()
    const result = waitForFrames(video, { timeoutMs: 3000, pollMs: 100 })
    await vi.advanceTimersByTimeAsync(150)
    tick()
    await vi.advanceTimersByTimeAsync(150)
    expect(await result).toBe(true)
  })

  it('does not count a frozen clock as frames', async () => {
    vi.useFakeTimers()
    const { video } = clockVideo()
    const result = waitForFrames(video, { timeoutMs: 1000, pollMs: 100 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toBe(false)
  })

  it('gives up early when the track ends', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    const stream = streamOf(false)
    video.srcObject = stream as unknown as MediaStream
    const result = waitForFrames(video, { timeoutMs: 3000 })
    await vi.advanceTimersByTimeAsync(100)
    stream.track.end()
    await vi.advanceTimersByTimeAsync(0)
    expect(await result).toBe(false)
  })

  it('stops when aborted', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    video.srcObject = streamOf(false) as unknown as MediaStream
    const abort = new AbortController()
    const result = waitForFrames(video, { timeoutMs: 3000, signal: abort.signal })
    abort.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await result).toBe(false)
  })
})

describe('watchFrames', () => {
  let undo: () => void
  beforeEach(() => {
    undo = installFakeVideo()
    vi.useFakeTimers()
  })
  afterEach(() => {
    undo()
    vi.useRealTimers()
  })

  it('stays quiet while frames keep arriving', async () => {
    const video = document.createElement('video')
    video.srcObject = streamOf(true) as unknown as MediaStream
    const onStall = vi.fn()
    const stop = watchFrames(video, { stallMs: 2000, onStall })
    await vi.advanceTimersByTimeAsync(6000)
    expect(onStall).not.toHaveBeenCalled()
    stop()
  })

  it('reports a stall once when frames stop for longer than stallMs', async () => {
    const video = document.createElement('video')
    const stream = streamOf(true)
    video.srcObject = stream as unknown as MediaStream
    const onStall = vi.fn()
    const stop = watchFrames(video, { stallMs: 2000, onStall })
    await vi.advanceTimersByTimeAsync(500)
    stream.flowing = false
    await vi.advanceTimersByTimeAsync(1500)
    expect(onStall).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1200)
    expect(onStall).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onStall).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reports a stall straight away when the track ends', async () => {
    const video = document.createElement('video')
    const stream = streamOf(true)
    video.srcObject = stream as unknown as MediaStream
    const onStall = vi.fn()
    const stop = watchFrames(video, { stallMs: 2000, onStall })
    await vi.advanceTimersByTimeAsync(100)
    stream.track.end()
    expect(onStall).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reports nothing after it has been stopped', async () => {
    const video = document.createElement('video')
    const stream = streamOf(true)
    video.srcObject = stream as unknown as MediaStream
    const onStall = vi.fn()
    const stop = watchFrames(video, { stallMs: 2000, onStall })
    stop()
    stream.flowing = false
    stream.track.end()
    await vi.advanceTimersByTimeAsync(5000)
    expect(onStall).not.toHaveBeenCalled()
  })
})
