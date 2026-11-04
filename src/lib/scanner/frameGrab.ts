/**
 * Turning camera frames and photos into pixels for the decoder.
 *
 * Live frames: the centre ~70 % square at native resolution (capped at
 * 1000 px), and every third attempt the whole frame (capped at 1280 px), so a
 * code off to the side is still found. Not qr-scanner's 400 px downscale, which
 * loses small or distant codes (research 03 §3).
 *
 * Photos: downscaled to a long side of at most 2000 px; full-size phone photos
 * are slow to decode (research 03 §4.7).
 */

export const CROP_FRACTION = 0.7
export const CROP_MAX_SIDE = 1000
export const FULL_FRAME_MAX_SIDE = 1280
export const FULL_FRAME_EVERY = 3
export const PHOTO_MAX_SIDE = 2000
export const PHOTO_CENTRE_FRACTION = 0.6

export interface Size {
  width: number
  height: number
}

export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface CropRect extends SourceRect {
  dw: number
  dh: number
}

export const fitWithin = (width: number, height: number, maxSide: number): Size => {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export const centreCropRect = (width: number, height: number, fraction: number): SourceRect => {
  const side = Math.round(Math.min(width, height) * fraction)
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), sw: side, sh: side }
}

export const frameCropRect = (width: number, height: number, attempt: number): CropRect => {
  if (attempt % FULL_FRAME_EVERY === 0) {
    const out = fitWithin(width, height, FULL_FRAME_MAX_SIDE)
    return { sx: 0, sy: 0, sw: width, sh: height, dw: out.width, dh: out.height }
  }
  const crop = centreCropRect(width, height, CROP_FRACTION)
  const out = fitWithin(crop.sw, crop.sh, CROP_MAX_SIDE)
  return { ...crop, dw: out.width, dh: out.height }
}

type Drawable = CanvasImageSource & { width?: number; height?: number }

let sharedCanvas: HTMLCanvasElement | null = null

const canvasOf = (width: number, height: number): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null
  sharedCanvas ??= document.createElement('canvas')
  if (sharedCanvas.width !== width) sharedCanvas.width = width
  if (sharedCanvas.height !== height) sharedCanvas.height = height
  return sharedCanvas.getContext('2d', { willReadFrequently: true })
}

/** Draws `rect` of `source` scaled to dw × dh and returns its pixels, or null when there is no canvas. */
export const readPixels = (source: Drawable, rect: CropRect): ImageData | null => {
  const ctx = canvasOf(rect.dw, rect.dh)
  if (!ctx) return null
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.dw, rect.dh)
  return ctx.getImageData(0, 0, rect.dw, rect.dh)
}

/** The pixels to decode for this attempt of a live video, or null when the video has no picture yet. */
export const grabVideoFrame = (video: HTMLVideoElement, attempt: number): ImageData | null => {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height || video.readyState < 2) return null
  return readPixels(video, frameCropRect(width, height, attempt))
}

interface LoadedImage {
  source: Drawable
  width: number
  height: number
  close: () => void
}

const loadWithImageElement = (blob: Blob): Promise<LoadedImage> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The photo could not be opened'))
    }
    image.src = url
  })

/** Opens a photo for drawing; createImageBitmap where it works, an <img> otherwise. */
export const loadImage = async (blob: Blob): Promise<LoadedImage> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Some Safari versions can't make a bitmap from certain JPEGs; the <img> path can.
    }
  }
  return loadWithImageElement(blob)
}

/** The whole photo, then its centre, each fitted within 2000 px. */
export const photoCropRects = (width: number, height: number): CropRect[] => {
  const whole = fitWithin(width, height, PHOTO_MAX_SIDE)
  const centre = centreCropRect(width, height, PHOTO_CENTRE_FRACTION)
  const centreOut = fitWithin(centre.sw, centre.sh, PHOTO_MAX_SIDE)
  return [
    { sx: 0, sy: 0, sw: width, sh: height, dw: whole.width, dh: whole.height },
    { ...centre, dw: centreOut.width, dh: centreOut.height },
  ]
}
