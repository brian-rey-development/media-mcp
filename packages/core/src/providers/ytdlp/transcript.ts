import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaError } from "../../domain/errors.js";
import type { Transcript, VideoRef } from "../../domain/media.js";
import { err, fail, ok, type Result } from "../../domain/result.js";
import { omitUndefined } from "../../infra/options.js";
import { withTempDirectory } from "../../infra/temp.js";
import type { TranscriptOptions } from "../provider.js";
import { metadataArgs } from "./args.js";
import {
  type CaptionChoice,
  candidatePattern,
  captionHint,
  exactPattern,
  selectCaption,
} from "./captions.js";
import {
  type ClientProfile,
  fallsBack,
  withFallbackProfile,
} from "./client-profile.js";
import { execYtDlp, type YtDlpDeps } from "./exec.js";
import { classifyFailure, summarizeDiagnostic } from "./failures.js";
import { ListingSchema, tracksOf, type YtDlpListing } from "./info.js";
import { parseJson3 } from "./json3.js";
import { parseYtDlpJson, printTemplate } from "./parse.js";

const TEMP_DIR_PREFIX = "media-mcp-subs-";
const SUBTITLE_FORMAT = "json3";
const CAPTION_BASENAME = "captions";
const IGNORE_ERRORS_FLAG = "--ignore-errors";

interface Request {
  deps: YtDlpDeps;
  url: string;
  ref: VideoRef;
  options: TranscriptOptions;
  signal: AbortSignal | undefined;
  trackRetry: { ranOn: ClientProfile | undefined };
}

const subtitleFlags = (pattern: string): string[] => [
  "--skip-download",
  "--sub-format",
  SUBTITLE_FORMAT,
  "--sub-langs",
  pattern,
  "--no-simulate",
  "-o",
  CAPTION_BASENAME,
];

const captionFileName = (key: string): string =>
  `${CAPTION_BASENAME}.${key}.${SUBTITLE_FORMAT}`;

// The pattern also matches machine translations, which YouTube often answers with 429. --ignore-errors turns
// those into warnings so they never fail the call or reach the rate-limit gate; the chosen file is checked below.
const captionArgs = (
  profile: ClientProfile,
  url: string,
  language: string,
): string[] =>
  metadataArgs(
    profile,
    [
      "--print",
      printTemplate(ListingSchema),
      "--write-subs",
      "--write-auto-subs",
      IGNORE_ERRORS_FLAG,
      ...subtitleFlags(candidatePattern(language)),
    ],
    url,
  );

// No --ignore-errors here: this request carries only the chosen track, so its failure is real and must reach the rate-limit gate.
const trackArgs = (
  profile: ClientProfile,
  url: string,
  { key, source }: CaptionChoice,
): string[] =>
  metadataArgs(
    profile,
    [
      source === "manual" ? "--write-subs" : "--write-auto-subs",
      ...subtitleFlags(exactPattern(key)),
    ],
    url,
  );

const noCaptions = (listing: YtDlpListing, language: string): Result<never> =>
  err(
    "NO_CAPTIONS",
    `No "${language}" captions are available for "${listing.title}"`,
    captionHint(tracksOf(listing)),
  );

const missingCaptionFile = (
  language: string,
  { key }: CaptionChoice,
  stderr: string,
): MediaError =>
  classifyFailure({
    code: "PROCESS_FAILED",
    message: summarizeDiagnostic(
      `The "${language}" caption file was not written`,
      stderr,
      key,
    ),
  });

const readCaptionFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
};

interface Chosen {
  listing: YtDlpListing;
  choice: CaptionChoice;
  directory: string;
}

const readChosenFile = ({ choice, directory }: Chosen) =>
  readCaptionFile(join(directory, captionFileName(choice.key)));

const transcriptOf = (
  { ref, options }: Request,
  { listing, choice }: Chosen,
  raw: string,
): Result<Transcript> => {
  const parsed = parseJson3(raw, options);
  if (!parsed.ok) return parsed;
  const { text, wordCount } = parsed.value;
  if (text === "") return noCaptions(listing, options.language);
  return ok({
    ref,
    title: listing.title,
    language: options.language,
    source: choice.source,
    text,
    wordCount,
    ...omitUndefined({ channel: listing.channel }),
  });
};

const fetchChosenTrack = async (
  request: Request,
  chosen: Chosen,
  profile: ClientProfile,
): Promise<Result<Transcript>> => {
  const { deps, url, signal, options } = request;
  request.trackRetry.ranOn = profile;
  const args = trackArgs(profile, url, chosen.choice);
  const run = await execYtDlp(deps, args, { signal, cwd: chosen.directory });
  if (!run.ok) return run;
  const raw = await readChosenFile(chosen);
  if (raw !== undefined) return transcriptOf(request, chosen, raw);
  return fail(
    missingCaptionFile(options.language, chosen.choice, run.value.stderr),
  );
};

// A track retry on the fast client is the last attempt of the transcript, so it only runs when the standard client would not follow anyway.
// That also keeps the retry to once per transcript, because the standard client lists at most once.
const mayRetryTrack = (profile: ClientProfile, missing: MediaError): boolean =>
  !fallsBack(profile, missing);

const fromListing = async (
  request: Request,
  directory: string,
  profile: ClientProfile,
  { listing, stderr }: { listing: YtDlpListing; stderr: string },
): Promise<Result<Transcript>> => {
  const { language } = request.options;
  const choice = selectCaption(tracksOf(listing), language);
  if (!choice) return noCaptions(listing, language);
  const chosen = { listing, choice, directory };
  const raw = await readChosenFile(chosen);
  if (raw !== undefined) return transcriptOf(request, chosen, raw);
  const missing = missingCaptionFile(language, choice, stderr);
  if (!mayRetryTrack(profile, missing)) return fail(missing);
  return fetchChosenTrack(request, chosen, profile);
};

const transcribeInto = async (
  request: Request,
  directory: string,
  profile: ClientProfile,
): Promise<Result<Transcript>> => {
  const { deps, url, options, signal } = request;
  const args = captionArgs(profile, url, options.language);
  const run = await execYtDlp(deps, args, { signal, cwd: directory });
  if (!run.ok) return run;
  const listing = parseYtDlpJson(ListingSchema, run.value.stdout);
  if (!listing.ok) return listing;
  const { stderr } = run.value;
  return fromListing(request, directory, profile, {
    listing: listing.value,
    stderr,
  });
};

export const fetchTranscript = (
  deps: YtDlpDeps,
  url: string,
  ref: VideoRef,
  options: TranscriptOptions,
  signal?: AbortSignal,
): Promise<Result<Transcript>> => {
  const trackRetry: Request["trackRetry"] = { ranOn: undefined };
  const request = { deps, url, ref, options, signal, trackRetry };
  return withFallbackProfile(
    (profile) =>
      withTempDirectory(TEMP_DIR_PREFIX, (directory) =>
        transcribeInto(request, directory, profile),
      ),
    { settled: () => trackRetry.ranOn === "fast" },
  );
};
