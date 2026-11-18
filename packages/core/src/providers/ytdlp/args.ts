import { type ClientProfile, extractorArgsFor } from "./client-profile.js";

const BASE_FLAGS = [
  "--ignore-config",
  "--no-plugin-dirs",
  "--js-runtimes",
  `node:${process.execPath}`,
] as const;
const URL_SEPARATOR = "--";
const EXTRACTOR_ARGS_FLAG = "--extractor-args";
// The fast client skips the https formats that need a PO token, so a video without a plain format would otherwise fail format selection although nothing is downloaded.
const IGNORE_NO_FORMATS_FLAG = "--ignore-no-formats-error";

export const baseArgs = (flags: readonly string[]): string[] => [
  ...BASE_FLAGS,
  ...flags,
];

export const urlArgs = (flags: readonly string[], url: string): string[] => [
  ...baseArgs(flags),
  URL_SEPARATOR,
  url,
];

// Only metadata requests get extractor args, downloads keep every stream the merge needs.
export const metadataArgs = (
  profile: ClientProfile,
  flags: readonly string[],
  url: string,
): string[] =>
  urlArgs(
    [
      EXTRACTOR_ARGS_FLAG,
      extractorArgsFor(profile),
      IGNORE_NO_FORMATS_FLAG,
      ...flags,
    ],
    url,
  );
