// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import QRCode from 'qrcode'
import { ZXING_WASM_VERSION } from 'barcode-detector/ponyfill'
import { createZxingEngine, locateZxingFile, ZXING_WASM_URL } from './zxingEngine'

const require = createRequire(import.meta.url)

// Node has no ImageData or DOMRectReadOnly; the ponyfill needs both.
const g = globalThis as Record<string, unknown>
g.ImageData ??= class ImageData {
  readonly colorSpace = 'srgb'
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}
const asImageData = (pixels: { data: Uint8ClampedArray; width: number; height: number }): ImageData =>
  new (g.ImageData as typeof ImageData)(pixels.data, pixels.width, pixels.height)
g.DOMRectReadOnly ??= class {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
}

/** A QR code as RGBA pixels, the shape the decoder gets from a canvas. */
const qrPixels = (text: string, scale = 6) => {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const quiet = 4
  const modules = qr.modules.size
  const side = (modules + quiet * 2) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (!qr.modules.get(y, x)) continue
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = ((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx
          data[px * 4] = 0
          data[px * 4 + 1] = 0
          data[px * 4 + 2] = 0
        }
      }
    }
  }
  return asImageData({ data, width: side, height: side })
}

describe('zxing engine', () => {
  it('serves the .wasm from our own origin, never the jsDelivr default', () => {
    const located = locateZxingFile('zxing_reader.wasm', 'https://fastly.jsdelivr.net/npm/zxing-wasm@3/dist/reader/')
    expect(located).toBe(ZXING_WASM_URL)
    expect(located).not.toMatch(/jsdelivr|unpkg|^https?:/)
    expect(located).toMatch(/zxing_reader.*\.wasm$/)
    expect(locateZxingFile('other.js', '/prefix/')).toBe('/prefix/other.js')
  })

  it('ships the wasm build that matches the JS glue barcode-detector uses', () => {
    // package.json isn't in zxing-wasm's exports map; walk up from the wasm file.
    const packageJson = join(dirname(require.resolve('zxing-wasm/reader/zxing_reader.wasm')), '..', '..', 'package.json')
    const wasmPackage = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      version: string
    }
    expect(wasmPackage.version).toBe(ZXING_WASM_VERSION)
  })

  it('decodes a real QR code payload with the real wasm', async () => {
    const wasmBinary = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
    const engine = createZxingEngine({ wasmBinary })
    const payload = JSON.stringify({ id: 'qr-in-1', type: 'CLOCK_IN', customerName: 'Avtrade' })
    const loaded = await engine.load()
    expect(loaded.wasmLoadMs).toBeGreaterThanOrEqual(0)
    expect(await engine.detect(qrPixels(payload))).toBe(payload)
  }, 20_000)

  it('returns null for a picture with no code', async () => {
    const wasmBinary = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
    const engine = createZxingEngine({ wasmBinary })
    const blank = asImageData({ data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 })
    expect(await engine.detect(blank)).toBeNull()
  }, 20_000)
})
