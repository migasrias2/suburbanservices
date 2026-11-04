/**
 * Decodes QR codes off the main thread, so a cheap phone's UI stays smooth
 * while zxing works. Receives ImageData (its buffer transferred, not copied).
 */
import { createZxingEngine } from './zxingEngine'
import type { DecoderRequest, DecoderResponse } from './decoderProtocol'

// The app's tsconfig uses the DOM lib, not the webworker one; this is all we need of it.
interface WorkerScope {
  onmessage: ((event: MessageEvent<DecoderRequest>) => void) | null
  postMessage(message: DecoderResponse): void
}

const scope = self as unknown as WorkerScope
const engine = createZxingEngine()

scope.onmessage = async (event) => {
  const request = event.data
  let response: DecoderResponse
  try {
    const { wasmLoadMs } = await engine.load()
    const text = request.type === 'detect' ? await engine.detect(request.image) : null
    response = { id: request.id, kind: 'result', text, wasmLoadMs }
  } catch (error) {
    response = {
      id: request.id,
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'Error',
    }
  }
  scope.postMessage(response)
}
