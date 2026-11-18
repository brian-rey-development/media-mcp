import type { ErrorCode, MediaError } from "../../domain/errors.js";
import { boundedMessage, linesOf } from "../../infra/stderr.js";
import {
  BOT_CHECK_HINT,
  DISK_SPACE_HINT,
  FFMPEG_INSTALL_HINT,
  NODE_RUNTIME_HINT,
  RETRY_HINT,
  THROTTLED_HINT,
  UPGRADE_HINT,
  VIDEO_UNAVAILABLE_HINT,
} from "./hints.js";

interface FailureRule {
  pattern: RegExp;
  code: ErrorCode;
  hint: string;
}

const DIAGNOSTIC_PREFIX = /^(?:ERROR|WARNING):\s*/;

const FAILURE_RULES: readonly FailureRule[] = [
  {
    pattern:
      /ff(?:mpeg|probe)[^\n]*not found|not found[^\n]*ff(?:mpeg|probe)|ff(?:mpeg|probe) is not installed/i,
    code: "TOOL_MISSING",
    hint: FFMPEG_INSTALL_HINT,
  },
  {
    pattern: /try again later|session has been rate-limited|captcha challenge/i,
    code: "RATE_LIMITED",
    hint: THROTTLED_HINT,
  },
  {
    pattern:
      /javascript runtime|js runtime|challenge solving|signature solving|nsig extraction|requested format is not available/i,
    code: "TOOL_OUTDATED",
    hint: NODE_RUNTIME_HINT,
  },
  {
    pattern:
      /video unavailable|this video is unavailable|private video|has been removed|no longer available|account associated with this video has been terminated|members-only|confirm your age/i,
    code: "VIDEO_UNAVAILABLE",
    hint: VIDEO_UNAVAILABLE_HINT,
  },
  {
    pattern: /not a bot|sign in to confirm/i,
    code: "RATE_LIMITED",
    hint: BOT_CHECK_HINT,
  },
  {
    pattern: /http error 429|too many requests/i,
    code: "RATE_LIMITED",
    hint: THROTTLED_HINT,
  },
  {
    pattern: /unable to extract|please report this issue/i,
    code: "TOOL_OUTDATED",
    hint: UPGRADE_HINT,
  },
  {
    pattern: /no space left on device/i,
    code: "IO_FAILED",
    hint: DISK_SPACE_HINT,
  },
];

export const classifyFailure = (error: MediaError): MediaError => {
  if (error.code !== "PROCESS_FAILED") return error;
  const rule = FAILURE_RULES.find(({ pattern }) => pattern.test(error.message));
  return {
    code: rule?.code ?? error.code,
    message: error.message,
    hint: rule?.hint ?? RETRY_HINT,
  };
};

export const isRateLimitFailure = (error: MediaError): boolean =>
  classifyFailure(error).code === "RATE_LIMITED";

const diagnosticAbout = (stderr: string, subject: string): string | undefined =>
  linesOf(stderr)
    .findLast(
      (line) => DIAGNOSTIC_PREFIX.test(line) && line.includes(`'${subject}'`),
    )
    ?.replace(DIAGNOSTIC_PREFIX, "");

export const summarizeDiagnostic = (
  summary: string,
  stderr: string,
  subject: string,
): string => {
  const detail = diagnosticAbout(stderr, subject);
  return boundedMessage(detail ? `${summary} (${detail})` : summary);
};
