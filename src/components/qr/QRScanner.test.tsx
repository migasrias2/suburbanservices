import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'
import type { DecodeTextOutcome } from './QRScanner'
import { isAppReloadIdle } from '@/lib/appReloadGuard'

/**
 * QRScanner's own guards around a save, on <QrCamera/> (faked). The camera can
 * hand over a decode while the last one is still being saved, so these guards
 * are what stop one poster being processed twice, or a failed one looping.
 * Ported from the old qr-scanner tests when that camera was removed (P6); the
 * camera's own lifecycle (release, reopen, leaks) is covered by QrCamera.test.
 */

vi.mock('@/services/supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  return { supabase: createFakeSupabase().supabase }
})
vi.mock('@/components/qr/scanner/QrCamera', async () => ({ QrCamera: (await import('@/test/fakeQrCamera')).FakeQrCamera }))

const { fakeCamera, resetFakeCamera } = await import('@/test/fakeQrCamera')
const { QRScanner } = await import('./QRScanner')

const CLOCK_IN = JSON.stringify({ id: 'qr-in-1', type: 'CLOCK_IN', customerName: 'Avtrade' })
const OTHER_CLOCK_IN = JSON.stringify({ id: 'qr-in-2', type: 'CLOCK_IN', customerName: 'Metalex' })
const ALREADY_IN = 'You are already clocked in.'
const NO_SIGNAL = "Couldn't reach the server."

let clock = 1_000_000
const save = vi.fn<(text: string) => Promise<DecodeTextOutcome>>()

const renderScanner = () =>
  render(
    <MemoryRouter>
      <QRScanner cleanerId="cleaner-1" cleanerName="Jean Test" onDecodeText={save} />
    </MemoryRouter>,
  )

const startScanning = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /start scanning/i }))
  await waitFor(() => expect(fakeCamera.active).toBe(true))
}

/** One camera decode, `atMs` after the test's start. Bypasses the camera's own pause, like a decode already in flight. */
const decode = async (text: string, atMs: number) => {
  clock = 1_000_000 + atMs
  await act(async () => {
    fakeCamera.onDecode?.(text)
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const rejectWith = (message: string) => save.mockResolvedValue({ status: 'failed', message, definitive: true })
const failWith = (message: string) => save.mockResolvedValue({ status: 'failed', message, definitive: false })

beforeEach(() => {
  resetFakeCamera()
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  save.mockReset()
  installTestLocalStorage()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('one poster held in view', () => {
  it('is saved once, and "Saving…" stays up (camera paused) while the first save is still going', async () => {
    const pending = deferred<DecodeTextOutcome>()
    save.mockReturnValue(pending.promise)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await decode(CLOCK_IN, 50)
    await decode(CLOCK_IN, 3100)

    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    expect(fakeCamera.paused).toBe(true)
    expect(isAppReloadIdle()).toBe(false)

    await act(async () => pending.resolve({ status: 'done' }))
    expect(fakeCamera.active).toBe(false)
    expect(isAppReloadIdle()).toBe(true)
  })
})

describe('after a failed scan', () => {
  it('does not retry the same code by itself, and the error stays on screen', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    await decode(CLOCK_IN, 5000)
    await decode(CLOCK_IN, 60_000)

    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/already clocked in/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('tells the cleaner how to scan again after a definitive rejection', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)

    expect(await screen.findByText(/already clocked in.*tap ✕ to scan again/i)).toBeInTheDocument()
  })

  it('retries a save that failed on the way after 3 s, with no ✕ hint', async () => {
    failWith(NO_SIGNAL)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    const message = await screen.findByText(/couldn't reach the server/i)
    expect(message).not.toHaveTextContent(/tap ✕/i)
    await decode(CLOCK_IN, 2000)
    expect(save).toHaveBeenCalledTimes(1)
    await decode(CLOCK_IN, 3500)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  })

  it('takes "Saving…" down and shows an error when the save throws', async () => {
    save.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)

    expect(await screen.findByText(/error processing qr code/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(fakeCamera.paused).toBe(false)
  })

  it('reads the same code again after Stop and Start (a new Start is a retry)', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()
    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    expect(fakeCamera.active).toBe(false)

    const pending = deferred<DecodeTextOutcome>()
    save.mockReturnValue(pending.promise)
    await startScanning()
    await decode(CLOCK_IN, 1000)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    await act(async () => pending.resolve({ status: 'done' }))
  })

  it('tries the same code again once the error is dismissed', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    fireEvent.click(screen.getByRole('button', { name: /dismiss message/i }))
    await decode(CLOCK_IN, 100)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  })

  it('reads a different code straight away', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    await decode(OTHER_CLOCK_IN, 100)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  })
})

describe('a second scan in the same visit', () => {
  it('is processed after a successful one (no stale "already handled")', async () => {
    save.mockResolvedValue({ status: 'done' })
    renderScanner()
    await startScanning()
    await decode(CLOCK_IN, 0)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: /start scanning/i })

    await startScanning()
    await decode(OTHER_CLOCK_IN, 10_000)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  })
})

describe('Stop', () => {
  it('turns the camera off at once', async () => {
    renderScanner()
    await startScanning()
    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    expect(fakeCamera.active).toBe(false)
    expect(screen.getByRole('button', { name: /start scanning/i })).toBeInTheDocument()
  })
})
