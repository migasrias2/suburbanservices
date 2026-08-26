import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The bucket's RLS policies key off the FIRST path segment being the owning
 * cleaner's uuid. If buildObjectPath ever stops producing that shape, uploads
 * start failing for everyone — so the convention is pinned here.
 */

let uploadArgs: { path: string; body: unknown; opts: Record<string, unknown> } | null = null
let uploadError: { message: string } | null = null
let signedResult: { data: unknown; error: unknown } = { data: [], error: null }

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        bucket,
        upload: (path: string, body: unknown, opts: Record<string, unknown>) => {
          uploadArgs = { path, body, opts }
          return Promise.resolve({ error: uploadError })
        },
        createSignedUrls: () => Promise.resolve(signedResult),
      }),
    },
  },
}))

const { uploadTaskPhoto, signTaskPhotoPaths, TASK_PHOTO_BUCKET } = await import('./photoStorageService')

const CLEANER = '796835c3-d199-40b2-a564-39b54ad63ae8'

describe('uploadTaskPhoto', () => {
  beforeEach(() => {
    uploadArgs = null
    uploadError = null
  })

  it('writes into a folder named for the owning cleaner, which is what RLS checks', async () => {
    const path = await uploadTaskPhoto(CLEANER, new Blob(['x'], { type: 'image/jpeg' }))

    expect(path.split('/')[0]).toBe(CLEANER)
    expect(uploadArgs?.path.split('/')[0]).toBe(CLEANER)
  })

  it('produces a unique path per photo so uploads never collide', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    const a = await uploadTaskPhoto(CLEANER, blob)
    const b = await uploadTaskPhoto(CLEANER, blob)

    expect(a).not.toBe(b)
  })

  it('never overwrites an existing object', async () => {
    await uploadTaskPhoto(CLEANER, new Blob(['x'], { type: 'image/jpeg' }))
    expect(uploadArgs?.opts.upsert).toBe(false)
  })

  it('accepts a data URL and uploads the decoded bytes, not the base64 text', async () => {
    // "hello" is 5 bytes decoded, 8 characters encoded
    await uploadTaskPhoto(CLEANER, 'data:image/jpeg;base64,aGVsbG8=')

    expect((uploadArgs?.body as Blob).size).toBe(5)
    expect(uploadArgs?.opts.contentType).toBe('image/jpeg')
  })

  it('refuses to build a path without a cleaner id', async () => {
    await expect(uploadTaskPhoto('', new Blob(['x']))).rejects.toThrow(/cleaner id is required/i)
  })

  it('throws on upload failure so the caller can fall back rather than losing the photo', async () => {
    uploadError = { message: 'quota exceeded' }

    await expect(uploadTaskPhoto(CLEANER, new Blob(['x']))).rejects.toThrow(/quota exceeded/)
  })

  it('targets the task-photos bucket', () => {
    expect(TASK_PHOTO_BUCKET).toBe('task-photos')
  })
})

describe('signTaskPhotoPaths', () => {
  beforeEach(() => {
    signedResult = { data: [], error: null }
  })

  it('returns an empty map for no paths without calling out', async () => {
    expect(await signTaskPhotoPaths([])).toEqual({})
  })

  it('maps each path to its signed url', async () => {
    signedResult = {
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://x/a1', error: null },
        { path: 'a/2.jpg', signedUrl: 'https://x/a2', error: null },
      ],
      error: null,
    }

    expect(await signTaskPhotoPaths(['a/1.jpg', 'a/2.jpg'])).toEqual({
      'a/1.jpg': 'https://x/a1',
      'a/2.jpg': 'https://x/a2',
    })
  })

  it('omits individual failures instead of breaking the whole dashboard', async () => {
    signedResult = {
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://x/a1', error: null },
        { path: 'a/gone.jpg', signedUrl: null, error: 'not found' },
      ],
      error: null,
    }

    const map = await signTaskPhotoPaths(['a/1.jpg', 'a/gone.jpg'])

    expect(map['a/1.jpg']).toBe('https://x/a1')
    expect(map['a/gone.jpg']).toBeUndefined()
  })

  it('returns an empty map rather than throwing when signing fails outright', async () => {
    signedResult = { data: null, error: { message: 'nope' } }

    expect(await signTaskPhotoPaths(['a/1.jpg'])).toEqual({})
  })
})
