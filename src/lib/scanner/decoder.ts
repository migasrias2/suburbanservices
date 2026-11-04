/**
 * Public decoder API: decodeFrame(video) for the live camera, decodeImage(blob)
 * for the still-photo fallback.
 *
 * Decoding runs in a Web Worker (decoder.worker.ts) with zxing-wasm. If the
 * worker can't start (old browser, blocked script), the same engine runs on
 * the main thread instead; the caller never needs to know. The scan loop in
 * scanSession.ts keeps one decode in flight at a time and paces attempts at
 * ~8 per second, which bounds the work on either path.
 *
 * Nothing loads until the first call (or warmUpDecoder), so the ~410 KB gzip
 * wasm costs nothing on screens that never scan.
 */
import { grabVideoFrame, loadImage, photoCropRects, readPixels } from './frameGrab'
import type { DecoderRequest, DecoderRequestBody, DecoderResponse } from './decoderProtocol'

export interface DecoderInfo {
  engine: 'worker' | 'main' | null
  wasmLoadMs: number | null
  loadError: string | null
}

interface Engine {
  readonly kind: 'worker' | 'main'
  readonly broken: boolean
  detect(image: ImageData): Promise<string | null>
  warmUp(): Promise<void>
}

class WorkerBrokenError extends Error {
  constructor() {
    super('The decoder worker stopped')
    this.name = 'WorkerBrokenError'
  }
}

let info: DecoderInfo = { engine: null, wasmLoadMs: null, loadError: null }

const noteLoaded = (engine: 'worker' | 'main', wasmLoadMs: number) => {
  info = { engine, wasmLoadMs: info.engine === engine ? info.wasmLoadMs ?? wasmLoadMs : wasmLoadMs, loadError: null }
}

const noteError = (message: string) => {
  info = { ...info, loadError: message }
}

const createWorkerEngine = (): Engine | null => {
  if (typeof Worker === 'undefined') return null
  let worker: Worker
  try {
    worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  let broken = false
  let nextId = 1
  const waiting = new Map<number, { resolve: (text: string | null) => void; reject: (error: Error) => void }>()

  worker.onmessage = (event: MessageEvent<DecoderResponse>) => {
    const response = event.data
    const pending = waiting.get(response.id)
    if (!pending) return
    waiting.delete(response.id)
    if (response.kind === 'result') {
      noteLoaded('worker', response.wasmLoadMs)
      pending.resolve(response.text)
      return
    }
    noteError(response.error)
    const error = new Error(response.error)
    error.name = response.errorName
    pending.reject(error)
  }
  worker.onerror = () => {
    broken = true
    worker.terminate()
    waiting.forEach(({ reject }) => reject(new WorkerBrokenError()))
    waiting.clear()
  }

  const send = (request: DecoderRequestBody, transfer: Transferable[] = []) =>
    new Promise<string | null>((resolve, reject) => {
      if (broken) {
        reject(new WorkerBrokenError())
        return
      }
      const id = nextId
      nextId += 1
      waiting.set(id, { resolve, reject })
      worker.postMessage({ ...request, id } as DecoderRequest, transfer)
    })

  return {
    kind: 'worker',
    get broken() {
      return broken
    },
    detect: (image) => send({ type: 'detect', image }, [image.data.buffer]),
    warmUp: () => send({ type: 'warmup' }).then(() => undefined),
  }
}

const createMainEngine = async (): Promise<Engine> => {
  const { createZxingEngine } = await import('./zxingEngine')
  const engine = createZxingEngine()
  const loaded = async () => {
    try {
      const { wasmLoadMs } = await engine.load()
      noteLoaded('main', wasmLoadMs)
    } catch (error) {
      noteError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  return {
    kind: 'main',
    broken: false,
    async detect(image) {
      await loaded()
      return engine.detect(image)
    },
    warmUp: loaded,
  }
}

let workerEngine: Engine | null | undefined
let mainEngine: Promise<Engine> | null = null

const getEngine = async (): Promise<Engine> => {
  if (workerEngine === undefined) workerEngine = createWorkerEngine()
  if (workerEngine && !workerEngine.broken) return workerEngine
  mainEngine ??= createMainEngine()
  return mainEngine
}

/** Runs on the worker; if the worker dies mid-call, once more on the main thread. */
const detect = async (image: ImageData, copy: ImageData | null): Promise<string | null> => {
  const engine = await getEngine()
  try {
    return await engine.detect(image)
  } catch (error) {
    if (!(error instanceof WorkerBrokenError) || !copy) throw error
    return (await getEngine()).detect(copy)
  }
}

/** The code in this frame of the live video, or null. Throws if the decoder can't load. */
export const decodeFrame = async (video: HTMLVideoElement, attempt: number): Promise<string | null> => {
  const pixels = grabVideoFrame(video, attempt)
  if (!pixels) return null
  return detect(pixels, null)
}

/** The code in a photo (whole picture first, then its centre), or null. */
export const decodeImage = async (image: Blob): Promise<string | null> => {
  const loaded = await loadImage(image)
  try {
    for (const rect of photoCropRects(loaded.width, loaded.height)) {
      const pixels = readPixels(loaded.source, rect)
      if (!pixels) return null
      const copy = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
      const text = await detect(pixels, copy)
      if (text) return text
    }
    return null
  } finally {
    loaded.close()
  }
}

/** Start loading the wasm now (e.g. when a scan screen opens). Never throws. */
export const warmUpDecoder = async (): Promise<void> => {
  try {
    await (await getEngine()).warmUp()
  } catch {
    // Recorded in getDecoderInfo().loadError; the next decode tries again.
  }
}

export const getDecoderInfo = (): DecoderInfo => ({ ...info })
