/**
 * Task photos used to go to the database at full sensor resolution, base64
 * encoded — averaging 193 KB per row and, at ~70 photos a shift, roughly 13 MB
 * of upload per cleaner per shift, usually on their own mobile data in a
 * building with poor signal.
 *
 * A proof-of-clean photo does not need 12 megapixels. Resizing the long edge to
 * 1280px at quality 0.7 keeps the detail a manager actually looks at and cuts
 * the payload by roughly an order of magnitude.
 */

export const PHOTO_MAX_EDGE = 1280
export const PHOTO_QUALITY = 0.7

export interface CompressedPhoto {
  blob: Blob
  /** data URL for local preview and offline draft storage */
  dataUrl: string
  width: number
  height: number
  bytes: number
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = src
  })

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })

const scaledDimensions = (width: number, height: number, maxEdge: number) => {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const ratio = maxEdge / longest
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  }
}

/**
 * Resize and re-encode a captured photo as JPEG.
 *
 * Falls back to the original bytes if anything about the canvas path fails —
 * a large photo is much better than a lost one when someone has already walked
 * to the far end of a warehouse to take it.
 */
export async function compressPhoto(
  source: Blob,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<CompressedPhoto> {
  const maxEdge = options.maxEdge ?? PHOTO_MAX_EDGE
  const quality = options.quality ?? PHOTO_QUALITY

  const originalDataUrl = await readAsDataUrl(source)

  try {
    const img = await loadImage(originalDataUrl)
    const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, maxEdge)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob) throw new Error('Could not re-encode the image')

    // A tiny source photo can come out larger after re-encoding; keep whichever
    // is smaller rather than blindly trusting the canvas.
    if (blob.size >= source.size) {
      return {
        blob: source,
        dataUrl: originalDataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        bytes: source.size,
      }
    }

    return {
      blob,
      dataUrl: canvas.toDataURL('image/jpeg', quality),
      width,
      height,
      bytes: blob.size,
    }
  } catch (error) {
    console.warn('Photo compression failed, using the original image:', error)
    return {
      blob: source,
      dataUrl: originalDataUrl,
      width: 0,
      height: 0,
      bytes: source.size,
    }
  }
}

/** Turn a stored data URL back into a Blob so it can be uploaded. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',')
  if (!encoded) throw new Error('Malformed data URL')
  // `||` not `??`: a header like "data:;base64" captures an empty string, which
  // ?? would happily pass through as the blob's content type.
  const mime = /:(.*?);/.exec(header)?.[1] || 'image/jpeg'
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}
