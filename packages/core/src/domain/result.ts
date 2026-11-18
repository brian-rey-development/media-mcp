import type { ErrorCode, MediaError } from "./errors.js";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: MediaError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (error: MediaError): Result<never> => ({
  ok: false,
  error,
});

export const err = (
  code: ErrorCode,
  message: string,
  hint?: string,
): Result<never> =>
  fail(hint === undefined ? { code, message } : { code, message, hint });

export const cancelled = (): Result<never> =>
  err("CANCELLED", "The operation was cancelled");
