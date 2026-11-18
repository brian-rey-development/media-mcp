export const ERROR_CODES = [
  "INVALID_URL",
  "UNSUPPORTED_URL",
  "VIDEO_UNAVAILABLE",
  "NO_CAPTIONS",
  "RATE_LIMITED",
  "TOOL_MISSING",
  "TOOL_OUTDATED",
  "TIMEOUT",
  "CANCELLED",
  "PROCESS_FAILED",
  "OUTPUT_PATH_ESCAPE",
  "CONFIG_INVALID",
  "PARSE_FAILED",
  "IO_FAILED",
  "FILE_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface MediaError {
  code: ErrorCode;
  message: string;
  hint?: string;
}
