// Moves legacy base64 task photos out of Postgres and into the task-photos
// bucket, one batch at a time.
//
// uk_cleaner_task_photos held 56,890 rows of base64 data URLs totalling ~12 GB
// — 99% of the database. New photos go straight to Storage; this drains the
// backlog.
//
// Resumable by design: it always picks up whatever is still un-migrated, so it
// can be called repeatedly (or on a schedule) until `remaining` reaches zero.
// Nothing is deleted until the upload for that row has succeeded.
//
//   POST /functions/v1/migrate-task-photos
//   { "batchSize": 200, "dryRun": false }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'task-photos'
const DEFAULT_BATCH = 200
const MAX_BATCH = 1000

interface MigrateRequest {
  batchSize?: number
  dryRun?: boolean
}

interface PhotoRow {
  id: number
  cleaner_id: string
  photo_data: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const commaAt = dataUrl.indexOf(',')
  if (commaAt === -1) throw new Error('not a data URL')

  const header = dataUrl.slice(0, commaAt)
  const payload = dataUrl.slice(commaAt + 1)
  const contentType = /:(.*?);/.exec(header)?.[1] ?? 'image/jpeg'

  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return { bytes, contentType }
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let body: MigrateRequest = {}
    try {
      body = await req.json()
    } catch {
      // no body is fine — use the defaults
    }

    const batchSize = Math.min(Math.max(body.batchSize ?? DEFAULT_BATCH, 1), MAX_BATCH)
    const dryRun = body.dryRun === true

    const { data: rows, error: selectError } = await supabase
      .from('uk_cleaner_task_photos')
      .select('id, cleaner_id, photo_data')
      .is('storage_path', null)
      .not('photo_data', 'is', null)
      .order('id', { ascending: true })
      .limit(batchSize)

    if (selectError) throw selectError

    const batch = (rows ?? []) as PhotoRow[]

    if (dryRun) {
      return new Response(
        JSON.stringify({ dryRun: true, wouldMigrate: batch.length, sampleIds: batch.slice(0, 5).map((r) => r.id) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let migrated = 0
    let skipped = 0
    let bytesMoved = 0
    const failures: { id: number; reason: string }[] = []

    for (const row of batch) {
      try {
        const { bytes, contentType } = decodeDataUrl(row.photo_data)
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
        failures: failures.slice(0, 10),
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
