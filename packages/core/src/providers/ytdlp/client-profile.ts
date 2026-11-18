import type { ErrorCode, MediaError } from "../../domain/errors.js";
import type { Result } from "../../domain/result.js";

export type ClientProfile = "fast" | "standard";

const SKIPPED_STREAMS = "youtube:skip=dash,hls,translated_subs";

const EXTRACTOR_ARGS: Record<ClientProfile, string> = {
  standard: SKIPPED_STREAMS,
  fast: `${SKIPPED_STREAMS};player_client=android_vr`,
};

const FAST_FAILURES_TO_RETRY: ReadonlySet<ErrorCode> = new Set([
  "NO_CAPTIONS",
  "PROCESS_FAILED",
  "PARSE_FAILED",
]);

export const extractorArgsFor = (profile: ClientProfile): string =>
  EXTRACTOR_ARGS[profile];

export const fallsBack = (profile: ClientProfile, error: MediaError): boolean =>
  profile === "fast" && FAST_FAILURES_TO_RETRY.has(error.code);

const isNoCaptions = <T>(result: Result<T>): boolean =>
  !result.ok && result.error.code === "NO_CAPTIONS";

const NEVER_LOOKED: ReadonlySet<ErrorCode> = new Set([
  "RATE_LIMITED",
  "CANCELLED",
]);

// The fast client already proved the language is missing, so a later failure of the standard client must not hide that
// answer, except a throttle or a cancellation, which say the standard client never got to look.
const truthful = <T>(fast: Result<T>, standard: Result<T>): Result<T> =>
  isNoCaptions(fast) &&
  !standard.ok &&
  !isNoCaptions(standard) &&
  !NEVER_LOOKED.has(standard.error.code)
    ? fast
    : standard;

interface FallbackOptions {
  // True once the fast attempt did work that a standard attempt must not repeat, which bounds the process count.
  settled?: () => boolean;
}

export const withFallbackProfile = async <T>(
  run: (profile: ClientProfile) => Promise<Result<T>>,
  { settled = () => false }: FallbackOptions = {},
): Promise<Result<T>> => {
  const fast = await run("fast");
  if (fast.ok || !fallsBack("fast", fast.error) || settled()) return fast;
  return truthful(fast, await run("standard"));
};
