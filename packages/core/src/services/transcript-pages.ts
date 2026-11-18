import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, lstat, open, realpath } from "node:fs/promises";
import { basename } from "node:path";
import { cancelled, err, ok, type Result } from "../domain/result.js";
import {
  hasErrorCode,
  isNotFound,
  redactedErrorMessage,
} from "../infra/errors.js";
import { excerptOf } from "../infra/excerpt.js";
import {
  type LinePage,
  type LineWindow,
  readLinePage,
} from "../infra/line-page.js";
import { resolveWithinRoot } from "../infra/paths.js";
import { redactPaths } from "../infra/redact.js";
import type { Runtime } from "./runtime.js";
import {
  isSavedTranscriptName,
  transcriptDirectoryPath,
} from "./transcript-file.js";
import type {
  Services,
  TranscriptPage,
  TranscriptPageRequest,
} from "./types.js";

export const DEFAULT_TRANSCRIPT_PAGE_LINES = 200;
export const MAX_TRANSCRIPT_PAGE_LINES = 1_000;
// About the default inline budget, so one page can never flood the context more than one inline transcript would.
export const MAX_TRANSCRIPT_PAGE_CHARS = 20_000;

const FIRST_LINE = 1;
const MAX_ECHOED_PATH_CHARS = 200;
const SYMLINK_LOOP_CODE = "ELOOP";
// Saved transcripts are line-wrapped text far below this, so a bigger file is something else.
const MAX_SAVED_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const SOLE_LINK = 1n;
// O_NOFOLLOW closes the gap between the containment check and the open, where the file could be swapped for a link.
// O_NONBLOCK keeps the open of a named pipe from waiting for a writer, and regular files ignore it.
const READ_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK;
const PATH_HINT = "Pass a filePath exactly as get_transcripts returned it";
const SAVED_ONLY_HINT =
  "Only transcripts saved by get_transcripts can be read, pass the filePath it returned";
const MISSING_HINT =
  "Call get_transcripts again to save the transcript, then pass the filePath it returns";
const RETRY_HINT = "Retry, or call get_transcripts again to save the file anew";

const shown = (path: string): string =>
  redactPaths(excerptOf(path, MAX_ECHOED_PATH_CHARS));

const outsideError = (path: string): Result<never> =>
  err(
    "OUTPUT_PATH_ESCAPE",
    `"${shown(path)}" is not a file inside the transcripts folder`,
    PATH_HINT,
  );

const missingError = (path: string): Result<never> =>
  err(
    "FILE_NOT_FOUND",
    `There is no transcript file at "${shown(path)}"`,
    MISSING_HINT,
  );

const notSavedError = (path: string): Result<never> =>
  err(
    "FILE_NOT_FOUND",
    `"${shown(path)}" is not a transcript saved by get_transcripts`,
    SAVED_ONLY_HINT,
  );

const unreadableError = (error: unknown): Result<never> =>
  err(
    "IO_FAILED",
    `The transcript file could not be read (${redactedErrorMessage(error)})`,
    RETRY_HINT,
  );

const openFailure = (path: string, error: unknown): Result<never> => {
  if (isNotFound(error)) return missingError(path);
  if (hasErrorCode(error, SYMLINK_LOOP_CODE)) return outsideError(path);
  return unreadableError(error);
};

const windowOf = ({
  startLine,
  maxLines,
}: TranscriptPageRequest): LineWindow => ({
  startLine: Math.max(FIRST_LINE, Math.trunc(startLine) || FIRST_LINE),
  maxLines: Math.min(
    MAX_TRANSCRIPT_PAGE_LINES,
    Math.max(1, Math.trunc(maxLines) || DEFAULT_TRANSCRIPT_PAGE_LINES),
  ),
  maxChars: MAX_TRANSCRIPT_PAGE_CHARS,
});

const locate = async (
  outputRoot: string,
  path: string,
): Promise<Result<string>> => {
  const resolved = await resolveWithinRoot(
    transcriptDirectoryPath(outputRoot),
    path,
  );
  if (!resolved.ok) return outsideError(path);
  return isSavedTranscriptName(basename(resolved.value))
    ? resolved
    : notSavedError(path);
};

const openFile = async (
  file: string,
  label: string,
): Promise<Result<FileHandle>> => {
  try {
    return ok(await open(file, READ_FLAGS));
  } catch (error) {
    return openFailure(label, error);
  }
};

const isStillTheOpenedFile = async (
  file: string,
  opened: BigIntStats,
): Promise<boolean> => {
  try {
    const [resolved, current] = await Promise.all([
      realpath(file),
      lstat(file, { bigint: true }),
    ]);
    return (
      resolved === file &&
      current.dev === opened.dev &&
      current.ino === opened.ino
    );
  } catch {
    return false;
  }
};

const refusalFor = async (
  handle: FileHandle,
  file: string,
  label: string,
): Promise<Result<never> | undefined> => {
  const stats = await handle.stat({ bigint: true });
  if (!stats.isFile()) return missingError(label);
  if (stats.size > MAX_SAVED_TRANSCRIPT_BYTES) return notSavedError(label);
  if (stats.nlink !== SOLE_LINK) return outsideError(label);
  return (await isStillTheOpenedFile(file, stats))
    ? undefined
    : outsideError(label);
};

const readPageAt = async (
  file: string,
  label: string,
  window: LineWindow,
  signal?: AbortSignal,
): Promise<Result<LinePage>> => {
  const opened = await openFile(file, label);
  if (!opened.ok) return opened;
  const handle = opened.value;
  try {
    const refusal = await refusalFor(handle, file, label);
    if (refusal) return refusal;
    return ok(await readLinePage(handle, window, signal));
  } catch (error) {
    return signal?.aborted ? cancelled() : unreadableError(error);
  } finally {
    await handle.close().catch(() => undefined);
  }
};

const toPage = (
  path: string,
  { startLine }: LineWindow,
  { lines, totalLines }: LinePage,
): TranscriptPage => {
  const nextStartLine = startLine + lines.length;
  return {
    path,
    startLine,
    lineCount: lines.length,
    totalLines,
    text: lines.join("\n"),
    ...(nextStartLine <= totalLines && { nextStartLine }),
  };
};

export const createTranscriptPageService = ({
  config,
}: Runtime): Services["transcriptFiles"] => ({
  async read(request, signal) {
    if (signal?.aborted) return cancelled();
    const located = await locate(config.outputRoot, request.path);
    if (!located.ok) return located;
    const window = windowOf(request);
    const page = await readPageAt(located.value, request.path, window, signal);
    return page.ok ? ok(toPage(located.value, window, page.value)) : page;
  },
});
