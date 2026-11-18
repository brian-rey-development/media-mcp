import { readdir, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import type {
  DownloadOptions,
  DownloadResult,
  MediaKind,
  Quality,
  VideoRef,
} from "../../domain/media.js";
import { err, ok, type Result } from "../../domain/result.js";
import { redactedErrorMessage } from "../../infra/errors.js";
import { removeQuietly } from "../../infra/files.js";
import { locateWithinRoot } from "../../infra/paths.js";
import { BYTES_PER_GIB, BYTES_PER_MEGABYTE } from "../../infra/units.js";
import { urlArgs } from "./args.js";
import { type ExecOptions, execYtDlp, type YtDlpDeps } from "./exec.js";
import {
  DISK_SPACE_HINT,
  DOWNLOAD_TIMEOUT_HINT,
  FFMPEG_INSTALL_HINT,
  SIZE_LIMIT_HINT,
} from "./hints.js";

const MIN_FREE_BYTES = BYTES_PER_GIB;
const MAX_TITLE_BYTES = 150;
const AUDIO_FORMAT = "m4a";
const VIDEO_CONTAINER = "mp4";
const QUICKTIME_SORT = "vcodec:h264,acodec:aac";
const AUDIO_LABEL = "audio";
const QUALITY_HEIGHTS = {
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
} as const;
// FFmpegMergerPP writes the merge as `<name>.temp.<ext>` and renames it only when ffmpeg succeeds.
const LEFTOVER_SUFFIX =
  /^(?:\.f[\w-]+\.\w+(?:\.(?:part(?:-Frag\d+)?|ytdl))?|\.\w+\.(?:part(?:-Frag\d+)?|ytdl)|\.temp\.\w+)$/;
// A failed audio extraction leaves the downloaded stream under its own extension, and only the m4a is the real result.
const UNEXTRACTED_AUDIO_SUFFIX = new RegExp(`^\\.(?!${AUDIO_FORMAT}$)\\w+$`);

const PROGRESS_TEMPLATE_TYPE = "download:";
const PROGRESS_PREFIX = "download:";
const PROGRESS_TEMPLATE = `${PROGRESS_TEMPLATE_TYPE}${PROGRESS_PREFIX}%(progress._percent_str)s`;
const PROGRESS_LINE = new RegExp(
  `^${PROGRESS_PREFIX}\\s*(\\d+(?:\\.\\d+)?)%\\s*$`,
);

const downloadLabel = (kind: MediaKind, quality: Quality): string =>
  kind === "audio" ? AUDIO_LABEL : quality;

const fileTag = (id: string, label: string): string => `[${id}] ${label}`;

const outputTemplate = (label: string): string =>
  `%(title).${MAX_TITLE_BYTES}B ${fileTag("%(id)s", label)}.%(ext)s`;

const videoFormat = (quality: Quality): string => {
  if (quality === "best") return "bv*+ba/b";
  const filter = `[height<=${QUALITY_HEIGHTS[quality]}]`;
  return `bv*${filter}+ba/b${filter}`;
};

const mediaFlags = (kind: MediaKind, quality: Quality): string[] =>
  kind === "audio"
    ? ["-x", "--audio-format", AUDIO_FORMAT]
    : [
        "-f",
        videoFormat(quality),
        "-S",
        QUICKTIME_SORT,
        "--merge-output-format",
        VIDEO_CONTAINER,
      ];

const outputFlags = (label: string): string[] => [
  "--restrict-filenames",
  "--newline",
  "--progress",
  "--progress-template",
  PROGRESS_TEMPLATE,
  "--print",
  "after_move:filepath",
  "-o",
  outputTemplate(label),
];

const downloadArgs = (
  url: string,
  { kind, quality }: DownloadOptions,
  maxBytes: number,
): string[] =>
  urlArgs(
    [
      ...mediaFlags(kind, quality),
      "--max-filesize",
      String(maxBytes),
      ...outputFlags(downloadLabel(kind, quality)),
    ],
    url,
  );

const progressOf = (line: string): number | undefined => {
  const percent = PROGRESS_LINE.exec(line)?.[1];
  return percent === undefined ? undefined : Number(percent);
};

const createLineTap = (onProgress: DownloadOptions["onProgress"]) => {
  let printed: string | undefined;
  const tap = (line: string): void => {
    const percent = progressOf(line);
    if (percent !== undefined) onProgress?.(percent);
    else if (line.trim() !== "") printed = line.trim();
  };
  return { tap, printedPath: () => printed };
};

const isLeftover = (name: string, marker: string, label: string): boolean => {
  const at = name.lastIndexOf(marker);
  if (at < 0) return false;
  const suffix = name.slice(at + marker.length);
  return (
    LEFTOVER_SUFFIX.test(suffix) ||
    (label === AUDIO_LABEL && UNEXTRACTED_AUDIO_SUFFIX.test(suffix))
  );
};

const removeLeftovers = async (
  directory: string,
  ref: VideoRef,
  label: string,
): Promise<void> => {
  const marker = fileTag(ref.id, label);
  const names = await readdir(directory).catch(() => []);
  await Promise.all(
    names
      .filter((name) => isLeftover(name, marker, label))
      .map((name) => removeQuietly(join(directory, name))),
  );
};

const checkFreeSpace = async (directory: string): Promise<Result<void>> => {
  try {
    const { bavail, bsize } = await statfs(directory);
    if (bavail * bsize >= MIN_FREE_BYTES) return ok(undefined);
    return err(
      "IO_FAILED",
      `The output disk has less than ${MIN_FREE_BYTES / BYTES_PER_MEGABYTE} MB free`,
      DISK_SPACE_HINT,
    );
  } catch {
    return ok(undefined);
  }
};

const notDownloaded = (maxBytes: number): Result<never> =>
  err(
    "PROCESS_FAILED",
    `Nothing was downloaded, the video is probably larger than the limit of ${Math.round(maxBytes / BYTES_PER_MEGABYTE)} MB`,
    SIZE_LIMIT_HINT,
  );

const mergeFailed = (): Result<never> =>
  err(
    "IO_FAILED",
    "The download finished but the merged file is missing",
    `Video and audio are merged with ffmpeg. ${FFMPEG_INSTALL_HINT}`,
  );

const describeFile = async (
  ref: VideoRef,
  kind: MediaKind,
  filePath: string,
): Promise<Result<DownloadResult>> => {
  try {
    const { size } = await stat(filePath);
    return ok({ ref, filePath, kind, bytes: size });
  } catch (error) {
    return err(
      "IO_FAILED",
      `The downloaded file could not be read (${redactedErrorMessage(error)})`,
    );
  }
};

interface Download {
  deps: YtDlpDeps;
  url: string;
  ref: VideoRef;
  options: DownloadOptions;
  signal: AbortSignal | undefined;
}

const execOptionsOf = (
  { config }: YtDlpDeps,
  { outputDir }: DownloadOptions,
  onStdoutLine: (line: string) => void,
  signal: AbortSignal | undefined,
): ExecOptions => ({
  signal,
  cwd: outputDir,
  timeoutMs: config.downloadTimeoutMs,
  timeoutHint: DOWNLOAD_TIMEOUT_HINT,
  onStdoutLine,
});

const locateDownload = async (
  ref: VideoRef,
  { outputDir, kind }: DownloadOptions,
  printed: string,
): Promise<Result<DownloadResult>> => {
  const located = await locateWithinRoot(outputDir, printed);
  if (!located.ok) return located;
  if (located.value === undefined) return mergeFailed();
  return describeFile(ref, kind, located.value);
};

const runDownload = async ({
  deps,
  url,
  ref,
  options,
  signal,
}: Download): Promise<Result<DownloadResult>> => {
  const lines = createLineTap(options.onProgress);
  const { maxDownloadBytes } = deps.config;
  const args = downloadArgs(url, options, maxDownloadBytes);
  const run = await execYtDlp(
    deps,
    args,
    execOptionsOf(deps, options, lines.tap, signal),
  );
  if (!run.ok) return run;
  const printed = lines.printedPath();
  if (!printed) return notDownloaded(maxDownloadBytes);
  return locateDownload(ref, options, printed);
};

export const downloadMedia = async (
  deps: YtDlpDeps,
  url: string,
  ref: VideoRef,
  options: DownloadOptions,
  signal?: AbortSignal,
): Promise<Result<DownloadResult>> => {
  const space = await checkFreeSpace(options.outputDir);
  if (!space.ok) return space;
  const result = await runDownload({ deps, url, ref, options, signal });
  if (!result.ok) {
    const label = downloadLabel(options.kind, options.quality);
    await removeLeftovers(options.outputDir, ref, label);
  }
  return result;
};
