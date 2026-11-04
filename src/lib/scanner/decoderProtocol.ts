/**
 * Messages between the decoder client (main thread) and decoder.worker.ts.
 * Discriminated by string `kind`: the app's tsconfig is not strict, and
 * without strictNullChecks TypeScript won't narrow on a boolean literal.
 */

export type DecoderRequest =
  | { id: number; type: 'warmup' }
  | { id: number; type: 'detect'; image: ImageData }

/** A request before the client gives it an id. */
export type DecoderRequestBody = DecoderRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never

export type DecoderResponse =
  | { id: number; kind: 'result'; text: string | null; wasmLoadMs: number }
  | { id: number; kind: 'error'; error: string; errorName: string }
