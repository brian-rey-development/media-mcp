import { err } from "../../domain/result.js";
import type { ProcessRunner } from "../../infra/process.js";
import { boundedMessage, linesOf } from "../../infra/stderr.js";

const WARNING_PREFIX = /^WARNING:\s*/;
const NO_FORMATS_WARNING =
  /^WARNING:\s*(?:No video formats found|This video is DRM protected)/;
const EXTRACTOR_WARNING = /^WARNING:\s*\[[\w:]+\]/;
const NO_FORMATS_MESSAGE = "The video has no playable formats";

// Metadata calls pass --ignore-no-formats-error to survive a format selection miss, but the flag also turns
// an empty format list (unavailable, private, bot check) into a warning, so that case is failed again here,
// before the rate-limit gate, which must still see a bot check.
const unplayableReason = (stderr: string): string | undefined => {
  const lines = linesOf(stderr);
  const noFormats = lines.findIndex((line) => NO_FORMATS_WARNING.test(line));
  if (noFormats === -1) return undefined;
  const reason = lines
    .slice(0, noFormats)
    .findLast((line) => EXTRACTOR_WARNING.test(line));
  return reason?.replace(WARNING_PREFIX, "") ?? NO_FORMATS_MESSAGE;
};

export const failWhenUnplayable =
  (run: ProcessRunner): ProcessRunner =>
  async (command, args, options) => {
    const result = await run(command, args, options);
    if (!result.ok) return result;
    const reason = unplayableReason(result.value.stderr);
    return reason === undefined
      ? result
      : err("PROCESS_FAILED", boundedMessage(reason));
  };
