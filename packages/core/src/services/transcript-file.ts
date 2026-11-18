import { join } from "node:path";
import type { Transcript } from "../domain/media.js";
import { err, ok, type Result } from "../domain/result.js";
import { UNTRUSTED_NOTICE } from "../domain/untrusted.js";
import { redactedErrorMessage } from "../infra/errors.js";
import { writeFileAtomically } from "../infra/files.js";
import { createDirectoryVerifier } from "../infra/paths.js";
import { redactPaths } from "../infra/redact.js";
import { formatOf } from "./keys.js";
import { wrapForFile } from "./transcript-wrap.js";
import type { DirectoryVerifier } from "./types.js";

const TRANSCRIPT_DIR = "transcripts";
const UNSAFE_NAME_CHARS = /[^A-Za-z0-9_-]/g;

interface SavedTranscript {
  path: string;
  body: string;
  charCount: number;
  lineCount: number;
}

export const transcriptDirectory = (outputRoot: string): DirectoryVerifier =>
  createDirectoryVerifier(outputRoot, TRANSCRIPT_DIR);

export const transcriptDirectoryPath = (outputRoot: string): string =>
  join(outputRoot, TRANSCRIPT_DIR);

const SAVED_NAME = /^[\w-]+\.[\w-]+\.(?:plain|timestamps)\.txt$/;

export const isSavedTranscriptName = (name: string): boolean =>
  SAVED_NAME.test(name);

const toFileNameSegment = (part: string): string =>
  part.replace(UNSAFE_NAME_CHARS, "_");

const fileNameOf = (
  { ref, language }: Transcript,
  timestamps: boolean,
): string => {
  const source = [ref.provider, ref.id].map(toFileNameSegment).join("-");
  return `${source}.${toFileNameSegment(language)}.${formatOf(timestamps)}.txt`;
};

const writeFailed = (path: string, error: unknown): Result<never> =>
  err(
    "IO_FAILED",
    `Could not write the transcript to ${redactPaths(path)}: ${redactedErrorMessage(error)}`,
    "Check that the output folder is writable",
  );

export const saveTranscript = async (
  directory: DirectoryVerifier,
  transcript: Transcript,
  timestamps: boolean,
): Promise<Result<SavedTranscript>> => {
  const verified = await directory();
  if (!verified.ok) return verified;
  const body = wrapForFile(transcript.text);
  const file = `${UNTRUSTED_NOTICE}\n\n${body}`;
  const path = join(verified.value, fileNameOf(transcript, timestamps));
  try {
    await writeFileAtomically(path, file);
  } catch (error) {
    return writeFailed(path, error);
  }
  const lineCount = file.split("\n").length;
  return ok({ path, body, charCount: file.length, lineCount });
};
