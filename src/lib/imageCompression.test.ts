import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressPhoto, dataUrlToBlob, PHOTO_MAX_EDGE } from './imageCompression'

/**
 * jsdom has no canvas or real image decoding, so the browser surfaces
 * compressPhoto depends on are stubbed. What is being tested is the decision
 * logic — scaling maths, the keep-the-smaller-file rule, and the fallback that
 * must never lose a photo — not the codec itself.
 */

type StubImage = {
  naturalWidth: number
  naturalHeight: number
  onload: (() => void) | null
  onerror: (() => void) | null
  src: string
}

let drawnSize: { w: number; h: number } | null = null
let encodedBlobSize = 1000
let failCanvas = false
let imageShouldFail = false
let imageDimensions = { w: 4000, h: 3000 }

const installStubs = () => {
  drawnSize = null

  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private _src = ''
      set src(value: string) {
        this._src = value
        queueMicrotask(() => {
          if (imageShouldFail) {
            this.onerror?.()
            return
          }
          this.naturalWidth = imageDimensions.w
          this.naturalHeight = imageDimensions.h
          this.onload?.()
        })
      }
      get src() {
        return this._src
      }
    } as unknown as typeof Image,
  )

  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') {
      return Object.create(HTMLElement.prototype)
    }
    return {
      width: 0,
      height: 0,
      getContext: () =>
        failCanvas
          ? null
          : {
              drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
                drawnSize = { w, h }
              },
            },
      toBlob: (cb: (b: Blob | null) => void) => {
        cb(new Blob([new Uint8Array(encodedBlobSize)], { type: 'image/jpeg' }))
      },
      toDataURL: () => 'data:image/jpeg;base64,Y29tcHJlc3NlZA==',
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
}

// FileReader in jsdom does not implement readAsDataURL for our synthetic blobs
// consistently, so give it a deterministic result.
class StubFileReader {
  result: string | null = null
  error: unknown = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(_blob: Blob) {
    this.result = 'data:image/jpeg;base64,b3JpZ2luYWw='
    queueMicrotask(() => this.onload?.())
  }
}

const makeBlob = (bytes: number, type = 'image/jpeg') =>
  new Blob([new Uint8Array(bytes)], { type })

describe('compressPhoto', () => {
  beforeEach(() => {
    failCanvas = false
    imageShouldFail = false
    encodedBlobSize = 1000
    imageDimensions = { w: 4000, h: 3000 }
    vi.stubGlobal('FileReader', StubFileReader as unknown as typeof FileReader)
    installStubs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('scales the long edge down to the cap and keeps the aspect ratio', async () => {
    imageDimensions = { w: 4000, h: 3000 }
    await compressPhoto(makeBlob(500_000))

    expect(drawnSize).toEqual({ w: PHOTO_MAX_EDGE, h: 960 })
  })

  it('scales by the taller edge for portrait photos', async () => {
    imageDimensions = { w: 3000, h: 4000 }
    await compressPhoto(makeBlob(500_000))

    expect(drawnSize).toEqual({ w: 960, h: PHOTO_MAX_EDGE })
  })

  it('does not upscale an image that is already small', async () => {
    imageDimensions = { w: 640, h: 480 }
    await compressPhoto(makeBlob(500_000))

    expect(drawnSize).toEqual({ w: 640, h: 480 })
  })

  it('cuts a typical 4MP phone photo down by an order of magnitude', async () => {
    encodedBlobSize = 120_000
    const original = makeBlob(2_000_000)

    const result = await compressPhoto(original)

    expect(result.bytes).toBe(120_000)
    expect(result.bytes).toBeLessThan(original.size / 10)
  })

  it('keeps the original when re-encoding would make the file bigger', async () => {
    // A small screenshot can come out larger after a JPEG round trip.
    encodedBlobSize = 90_000
    const original = makeBlob(40_000)

    const result = await compressPhoto(original)

    expect(result.bytes).toBe(40_000)
    expect(result.blob).toBe(original)
  })

  it('falls back to the original photo rather than losing it when the canvas is unavailable', async () => {
    failCanvas = true
    const original = makeBlob(750_000)

    const result = await compressPhoto(original)

    expect(result.blob).toBe(original)
    expect(result.bytes).toBe(750_000)
    expect(result.dataUrl).toContain('data:image/jpeg;base64,')
  })

  it('falls back when the image cannot be decoded at all', async () => {
    imageShouldFail = true
    const original = makeBlob(750_000)

    const result = await compressPhoto(original)

    expect(result.blob).toBe(original)
  })

  it('honours an explicit max edge', async () => {
    imageDimensions = { w: 4000, h: 2000 }
    await compressPhoto(makeBlob(500_000), { maxEdge: 800 })

    expect(drawnSize).toEqual({ w: 800, h: 400 })
  })
})

describe('dataUrlToBlob', () => {
  it('round-trips a data URL into bytes of the declared type', () => {
    // "hello" base64-encoded
    const blob = dataUrlToBlob('data:image/jpeg;base64,aGVsbG8=')

    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBe(5)
  })

  it('defaults to jpeg when the header omits a mime type', () => {
    const blob = dataUrlToBlob('data:;base64,aGVsbG8=')
    expect(blob.type).toBe('image/jpeg')
  })

  it('rejects a malformed data URL instead of uploading nonsense', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow(/Malformed data URL/)
  })
})
