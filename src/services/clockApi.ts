import { z } from 'zod'
import { supabase } from './supabase'

/**
 * Typed client for the server clock (migration 20261105090000_server_clock_core.sql).
 *
 * The database decides who you are, which code you scanned, what time it is and
 * whether the shift was saved. This module only sends the scan and turns the
 * answer into a discriminated union. Business outcomes come back as `code`s;
 * anything that stopped the request reaching the database is `network`, never
 * "not clocked in". Not wired into the app yet: P3 switches the clock screens
 * over behind the `clock_v2` switch.
 */

export const CLOCK_SUCCESS_CODES = [
  'clocked_in',
  'already_clocked_in',
  'clocked_out',
  'already_clocked_out',
  'late_clock_out',
] as const

export const CLOCK_FAILURE_CODES = [
  'no_open_shift',
  'too_late',
  'already_corrected',
  'duplicate_clock_in',
  'duplicate_event',
  'unknown_qr',
  'wrong_qr_type',
  'not_signed_in',
  'not_staff',
  'inactive',
  'role_not_allowed',
  'bad_request',
  // Per-person throttle (30+ attempts in 10 min). Nothing was written: retry later.
  'rate_limited',
  // The scan waited too long on the phone (clock-in > 16 h, clock-out > 24 h). Final.
  'stale_scan',
] as const

export type ClockSuccessCode = (typeof CLOCK_SUCCESS_CODES)[number]
export type ClockFailureCode = (typeof CLOCK_FAILURE_CODES)[number]

const shiftSchema = z
  .object({
    id: z.number().int(),
    worker_role: z.enum(['cleaner', 'ops_manager']),
    customer_name: z.string(),
    site_name: z.string(),
    clock_in: z.string().nullable(),
    clock_out: z.string().nullable(),
    business_day: z.string().nullable(),
    needs_review: z.boolean(),
    clock_in_source: z.string().nullable(),
    close_source: z.string().nullable(),
    auto_closed: z.boolean(),
    clock_out_missing: z.boolean(),
  })
  .transform((row) => ({
    id: row.id,
    workerRole: row.worker_role,
    customerName: row.customer_name,
    siteName: row.site_name,
    clockIn: row.clock_in,
    clockOut: row.clock_out,
    businessDay: row.business_day,
    needsReview: row.needs_review,
    clockInSource: row.clock_in_source,
    closeSource: row.close_source,
    autoClosed: row.auto_closed,
    clockOutMissing: row.clock_out_missing,
  }))

const qrSchema = z
  .object({
    id: z.string().nullable(),
    kind: z.string().nullable(),
    status: z.string().nullable(),
    customer_name: z.string().nullable(),
    site_name: z.string().nullable(),
  })
  .transform((qr) => ({
    id: qr.id,
    kind: qr.kind,
    status: qr.status,
    customerName: qr.customer_name,
    siteName: qr.site_name,
  }))

const commonFields = {
  message: z.string(),
  flags: z.array(z.string()),
  qr: qrSchema.nullable(),
  replay: z.boolean(),
  server_now: z.string(),
}

// A success always carries the shift it is about; a failure may or may not.
const clockResultSchema = z
  .discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), code: z.enum(CLOCK_SUCCESS_CODES), shift: shiftSchema, ...commonFields }),
    z.object({ ok: z.literal(false), code: z.enum(CLOCK_FAILURE_CODES), shift: shiftSchema.nullable(), ...commonFields }),
  ])
  .transform(({ server_now, ...rest }) => ({ ...rest, serverNow: server_now }))

const currentShiftSchema = z
  .object({
    ok: z.boolean(),
    code: z.enum(['clocked_in', 'not_clocked_in', 'not_signed_in']),
    open_shift: shiftSchema.nullable(),
    last_closed: shiftSchema.nullable(),
    server_now: z.string(),
    london_today: z.string().optional(),
  })
  .transform((row) => ({
    ok: row.ok,
    code: row.code,
    openShift: row.open_shift,
    lastClosed: row.last_closed,
    serverNow: row.server_now,
    londonToday: row.london_today ?? null,
  }))

export type ClockShift = z.output<typeof shiftSchema>
export type ClockQr = z.output<typeof qrSchema>
export type ClockServerResult = z.output<typeof clockResultSchema>

export type ClockTransportFailure = {
  ok: false
  code: 'network' | 'invalid_response'
  message: string
  cause?: { code?: string; message: string }
}

export type ClockLocalRefusal = { ok: false; code: 'bad_request'; message: string }

export type ClockResult = ClockServerResult | ClockTransportFailure | ClockLocalRefusal

export type CurrentShiftResult =
  | (z.output<typeof currentShiftSchema> & { ok: true; code: 'clocked_in' | 'not_clocked_in' })
  | { ok: false; code: 'not_signed_in'; message: string }
  | ClockTransportFailure

export type ClockParams = {
  /** Client-generated uuid, the same across retries of one scan. */
  eventId: string
  /** The raw text the scanner decoded. The server parses and checks it. */
  qrPayload: string
  /** When the phone saw the code (informational; the server keeps its own time). */
  scannedAt?: Date | string | null
  /** How long the scan waited on the phone before this send. */
  waitMs?: number
  location?: { latitude: number; longitude: number } | null
  device?: Record<string, unknown>
}

export type ClockFlags = { clockV2: boolean; scannerV2: boolean; source: 'server' | 'default' | 'not_ready' }

const paramsSchema = z.object({
  eventId: z.string().uuid(),
  qrPayload: z.string().refine((value) => value.trim().length > 0 && value.length <= 2048),
})

const NETWORK_MESSAGE = "Couldn't reach the server. Your scan is kept; it will be sent when you have signal."
const INVALID_MESSAGE = 'The server sent an answer this app version does not understand.'

type RpcError = { message?: string; code?: string } | null

const networkFailure = (error: unknown): ClockTransportFailure => {
  const source = (error ?? {}) as RpcError & { message?: unknown }
  const message = typeof source?.message === 'string' ? source.message : String(error)
  const cause = source?.code ? { code: source.code, message } : { message }
  return { ok: false, code: 'network', message: NETWORK_MESSAGE, cause }
}

const invalidResponse = (detail: unknown): ClockTransportFailure => {
  console.error('Unexpected clock response', detail)
  return { ok: false, code: 'invalid_response', message: INVALID_MESSAGE }
}

// p_wait_ms is a database integer (max ~24.8 days). Anything near that is
// nonsense anyway (the server caps at 60 min / 12 h), so 7 days is plenty.
export const MAX_WAIT_MS = 7 * 86_400_000

const toRpcParams = (params: ClockParams) => {
  const wait = Number.isFinite(params.waitMs) ? Math.min(MAX_WAIT_MS, Math.max(0, Math.round(params.waitMs as number))) : 0
  const scannedAt =
    params.scannedAt instanceof Date ? params.scannedAt.toISOString() : (params.scannedAt ?? null)
  return {
    p_event_id: params.eventId,
    p_qr_payload: params.qrPayload,
    p_scanned_at: scannedAt,
    p_wait_ms: wait,
    p_lat: params.location?.latitude ?? null,
    p_lng: params.location?.longitude ?? null,
    p_device: params.device ?? {},
  }
}

async function callClock(fn: 'clock_in' | 'clock_out', params: ClockParams): Promise<ClockResult> {
  if (!paramsSchema.safeParse(params).success) {
    return { ok: false, code: 'bad_request', message: 'The scan could not be sent. Please scan again.' }
  }
  try {
    const { data, error } = await supabase.rpc(fn, toRpcParams(params))
    if (error) {
      console.warn(`${fn} did not reach the database`, error)
      return networkFailure(error)
    }
    const parsed = clockResultSchema.safeParse(data)
    return parsed.success ? parsed.data : invalidResponse(parsed.error.issues)
  } catch (error) {
    console.warn(`${fn} request failed`, error)
    return networkFailure(error)
  }
}

/** Sends a clock-in scan. Safe to retry with the same eventId. */
export const clockIn = (params: ClockParams): Promise<ClockResult> => callClock('clock_in', params)

/** Sends a clock-out scan. Safe to retry with the same eventId. */
export const clockOut = (params: ClockParams): Promise<ClockResult> => callClock('clock_out', params)

/** The server's answer to "am I clocked in?" (no day window, so night shifts work). */
export async function getCurrentShift(): Promise<CurrentShiftResult> {
  try {
    const { data, error } = await supabase.rpc('current_shift')
    if (error) {
      console.warn('current_shift did not reach the database', error)
      return networkFailure(error)
    }
    const parsed = currentShiftSchema.safeParse(data)
    if (!parsed.success) return invalidResponse(parsed.error.issues)
    if (parsed.data.code === 'not_signed_in') {
      return { ok: false, code: 'not_signed_in', message: 'Please sign in again.' }
    }
    return { ...parsed.data, ok: true, code: parsed.data.code }
  } catch (error) {
    console.warn('current_shift request failed', error)
    return networkFailure(error)
  }
}

const DEFAULT_FLAGS: ClockFlags = { clockV2: true, scannerV2: true, source: 'default' }

// PostgREST "table not in schema cache" and Postgres "undefined table".
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])

// Kill switches are ON unless explicitly off (D9), so a typo can't disable them.
const isOn = (value: unknown) => value !== false && value !== 'false'

/** Remote kill switches from app_config. Defaults to ON when they can't be read. */
export async function getClockFlags(): Promise<ClockFlags> {
  try {
    const { data, error } = await supabase.from('app_config').select('key, value')
    // No switch table means the server clock migration isn't applied yet, so the
    // new clock RPCs don't exist either: keep the old clock, the new camera is fine.
    if (error && MISSING_TABLE_CODES.has(String((error as RpcError)?.code ?? ''))) {
      console.warn('app_config does not exist yet; keeping the old clock', error)
      return { clockV2: false, scannerV2: true, source: 'not_ready' }
    }
    if (error || !Array.isArray(data)) {
      if (error) console.warn('Could not read app_config; using default switches', error)
      return DEFAULT_FLAGS
    }
    const values = new Map((data as { key: string; value: unknown }[]).map((row) => [row.key, row.value]))
    return {
      clockV2: isOn(values.get('clock_v2')),
      scannerV2: isOn(values.get('scanner_v2')),
      source: 'server',
    }
  } catch (error) {
    console.warn('app_config request failed; using default switches', error)
    return DEFAULT_FLAGS
  }
}
