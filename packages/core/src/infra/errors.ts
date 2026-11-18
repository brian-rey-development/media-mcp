import { redactPaths } from "./redact.js";

export const NOT_FOUND_CODE = "ENOENT";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

export const isNotFound = (error: unknown): boolean =>
  hasErrorCode(error, NOT_FOUND_CODE);

export const redactedErrorMessage = (error: unknown): string =>
  redactPaths(errorMessage(error));
