import { supabase } from './supabase'
import { dataUrlToBlob } from '../lib/imageCompression'

export const TASK_PHOTO_BUCKET = 'task-photos'

/** Signed URLs are cheap but not free; an hour comfortably outlives a dashboard session. */
const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * Object paths are `<cleaner_id>/<uuid>.jpg`. The first segment is what the
 * bucket's RLS policies key off, so it must always be the owning cleaner.
 */
function buildObjectPath(cleanerId: string, extension = 'jpg'): string {
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  return `${cleanerId}/${unique}.${extension}`
}

/**
 * Upload one task photo and return its storage path.
 * Throws on failure so the caller can decide whether to fall back to base64.
 */
export async function uploadTaskPhoto(cleanerId: string, photo: Blob | string): Promise<string> {
  if (!cleanerId) throw new Error('A cleaner id is required to store a photo')

  const blob = typeof photo === 'string' ? dataUrlToBlob(photo) : photo
  const path = buildObjectPath(cleanerId)

  const { error } = await supabase.storage.from(TASK_PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    cacheControl: '3600',
    upsert: false,
  })

  if (error) {
    throw new Error(`Photo upload failed: ${error.message}`)
  }

  return path
}

/**
 * Resolve storage paths to signed URLs in one round trip.
 * Paths that fail to sign are simply omitted — a missing thumbnail should never
 * take down the dashboard that renders it.
 */
export async function signTaskPhotoPaths(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (!unique.length) return {}

  const { data, error } = await supabase.storage
    .from(TASK_PHOTO_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS)

  if (error) {
    console.error('Could not sign task photo URLs:', error)
    return {}
  }

  return (data ?? []).reduce<Record<string, string>>((acc, entry) => {
    if (entry.path && entry.signedUrl && !entry.error) {
      acc[entry.path] = entry.signedUrl
    }
    return acc
  }, {})
}
