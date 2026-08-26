// Moves legacy base64 task photos out of Postgres into the task-photos bucket.
// Resumable: call repeatedly until `remaining` is zero. Nothing is deleted
// until that row's upload has succeeded.
//
// Memory note: an earlier version selected photo_data for the whole batch at
// once. With rows up to ~9 MB of base64 that reached ~900 MB and the worker was
// killed with WORKER_RESOURCE_LIMIT. It now fetches ids first and pulls each
// photo individually, so peak memory is one photo regardless of batch size.
//
//   POST /functions/v1/migrate-task-photos
//   { "batchSize": 50, "dryRun": false }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'task-photos'
const DEFAULT_BATCH = 50
const MAX_BATCH = 300

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function decodeDataUrl(dataUrl: string) {
  const commaAt = dataUrl.indexOf(',')
  if (commaAt === -1) throw new Error('not a data URL')
  const header = dataUrl.slice(0, commaAt)
  const payload = dataUrl.slice(commaAt + 1)
  const contentType = /:(.*?);/.exec(header)?.[1] || 'image/jpeg'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return { bytes, contentType }
}

function extensionFor(contentType: string) {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('heic')) return 'heic'
  if (contentType.includes('heif')) return 'heif'
  return 'jpg'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let body: { batchSize?: number; dryRun?: boolean } = {}
    try {
      body = await req.json()
    } catch {
      // defaults are fine
    }

    const batchSize = Math.min(Math.max(body.batchSize ?? DEFAULT_BATCH, 1), MAX_BATCH)
    const dryRun = body.dryRun === true

    // ids only — deliberately does NOT select photo_data
    const { data: ids, error: selectError } = await supabase
      .from('uk_cleaner_task_photos')
      .select('id, cleaner_id')
      .is('storage_path', null)
      .not('photo_data', 'is', null)
      .order('id', { ascending: true })
      .limit(batchSize)

    if (selectError) throw selectError
    const batch = (ids ?? []) as { id: number; cleaner_id: string }[]

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          wouldMigrate: batch.length,
          sampleIds: batch.slice(0, 5).map((r) => r.id),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let migrated = 0
    let skipped = 0
    let bytesMoved = 0
    const failures: { id: number; reason: string }[] = []

    for (const row of batch) {
      try {
        // one photo in memory at a time
        const { data: full, error: rowError } = await supabase
          .from('uk_cleaner_task_photos')
          .select('photo_data')
          .eq('id', row.id)
          .single()
        if (rowError) throw rowError
        if (!full?.photo_data) {
          skipped += 1
          continue
        }

        const { bytes, contentType } = decodeDataUrl(full.photo_data as string)
        const path = `${row.cleaner_id}/${crypto.randomUUID()}.${extensionFor(contentType)}`

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType, cacheControl: '3600', upsert: false })
        if (uploadError) throw uploadError

        // Only drop the inline copy once the object is safely in the bucket.
        const { error: updateError } = await supabase
          .from('uk_cleaner_task_photos')
          .update({ storage_path: path, photo_data: null, file_size: bytes.byteLength })
          .eq('id', row.id)

        if (updateError) {
          // Roll back the orphaned object so a retry doesn't leave litter.
          await supabase.storage.from(BUCKET).remove([path])
          throw updateError
        }

        migrated += 1
        bytesMoved += bytes.byteLength
      } catch (err) {
        skipped += 1
        failures.push({ id: row.id, reason: err instanceof Error ? err.message : String(err) })
      }
    }

    const { count: remaining } = await supabase
      .from('uk_cleaner_task_photos')
      .select('id', { count: 'exact', head: true })
      .is('storage_path', null)
      .not('photo_data', 'is', null)

    return new Response(
      JSON.stringify({
        migrated,
        skipped,
        megabytesMoved: Math.round((bytesMoved / 1048576) * 100) / 100,
        remaining: remaining ?? null,
        failures: failures.slice(0, 5),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('migrate-task-photos failed:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
