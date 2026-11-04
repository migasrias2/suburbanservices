/**
 * zxing-wasm through the `barcode-detector` ponyfill (decision D10).
 *
 * Always the ponyfill, never the browser's own BarcodeDetector:
 * - iPhones have no native BarcodeDetector at all;
 * - on Android it wraps Google's deprecated Mobile Vision, which returns an
 *   empty list instead of an error when its module isn't downloaded, so a
 *   phone can show a sharp picture that never decodes (research 03 §0.3);
 * - one engine everywhere means one thing to debug.
 * The ponyfill already reads with tryHarder, tryInvert and tryDownscale.
 *
 * The .wasm is self-hosted: Vite's `?url` import emits it as a hashed asset
 * of this app, and locateFile points the loader at it instead of jsDelivr.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { BarcodeDetector, prepareZXingModule, purgeZXingModule } from 'barcode-detector/ponyfill'

export const ZXING_WASM_URL: string = wasmUrl

export const locateZxingFile = (path: string, prefix: string): string =>
  path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path

export interface ZxingEngineOptions {
  /** The wasm bytes themselves (tests in Node); browsers fetch ZXING_WASM_URL. */
  wasmBinary?: ArrayBuffer | Uint8Array
}

export interface LoadedZxing {
  detector: BarcodeDetector
  wasmLoadMs: number
}

export interface ZxingEngine {
  load(): Promise<LoadedZxing>
  detect(image: ImageData): Promise<string | null>
}

export const createZxingEngine = (options: ZxingEngineOptions = {}): ZxingEngine => {
  let loading: Promise<LoadedZxing> | null = null

  const load = (): Promise<LoadedZxing> => {
    loading ??= (async () => {
      const started = performance.now()
      const overrides = options.wasmBinary
        ? { locateFile: locateZxingFile, wasmBinary: options.wasmBinary }
        : { locateFile: locateZxingFile }
      await prepareZXingModule({ overrides, fireImmediately: true })
      const detector = new BarcodeDetector({ formats: ['qr_code'] })
      return { detector, wasmLoadMs: Math.round(performance.now() - started) }
    })().catch((error: unknown) => {
      // A failed download must not stick: drop it so the next attempt fetches again.
      loading = null
      purgeZXingModule()
      throw error
    })
    return loading
  }

  return {
    load,
    async detect(image) {
      const { detector } = await load()
      const found = await detector.detect(image)
      return found.find((barcode) => barcode.rawValue)?.rawValue ?? null
    },
  }
}
