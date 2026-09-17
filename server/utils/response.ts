/**
 * Typed response envelope for V2 API routes. Standardizes the success/error
 * shape so the client can narrow against a single discriminated union instead
 * of guessing at ad-hoc bodies.
 *
 * **Use these helpers in any new V2 route.** Existing routes can be migrated
 * incrementally — `request<T>` on the client tolerates both the bare-body
 * and enveloped shapes during the transition.
 *
 *   return ok({ counts });               // 200 { ok: true, data: { counts } }
 *   return err("Invalid body", 400);     // 400 { ok: false, error: ... }
 */

export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrEnvelope {
  ok: false;
  error: string;
  /** Optional machine-readable code, e.g. "VALIDATION", "NOT_FOUND". */
  code?: string;
}

export type Envelope<T> = OkEnvelope<T> | ErrEnvelope;

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data } satisfies OkEnvelope<T>, init);
}

export function err(
  error: string,
  status: number = 400,
  code?: string,
): Response {
  const body: ErrEnvelope = code
    ? { ok: false, error, code }
    : { ok: false, error };
  return Response.json(body, { status });
}
