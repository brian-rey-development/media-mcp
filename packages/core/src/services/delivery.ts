import type { MediaError } from "../domain/errors.js";
import type { Transcript } from "../domain/media.js";
import { ok, type Result } from "../domain/result.js";
import { excerptOf } from "../infra/excerpt.js";
import { omitUndefined } from "../infra/options.js";
import { applyBudget } from "./budget.js";
import { saveTranscript, transcriptDirectory } from "./transcript-file.js";
import {
  type DirectoryVerifier,
  type TranscriptDelivery,
  type UrlEntry,
  withValue,
} from "./types.js";

export const PREVIEW_CHARS = 500;

export const FILE_ENTRY_OVERHEAD_CHARS = 1_000;

export const MAX_FAILURE_TEXT_CHARS = 500;

interface DeliveryOptions {
  outputRoot: string;
  budget: number;
  timestamps: boolean;
}

type FailedEntry = Extract<UrlEntry<Transcript>, { ok: false }>;

const deliverAsFile = async (
  transcript: Transcript,
  directory: DirectoryVerifier,
  timestamps: boolean,
): Promise<Result<TranscriptDelivery>> => {
  const { text: _text, ...rest } = transcript;
  const saved = await saveTranscript(directory, transcript, timestamps);
  if (!saved.ok) return saved;
  const { path, body, charCount, lineCount } = saved.value;
  return ok({
    ...rest,
    mode: "file",
    filePath: path,
    preview: excerptOf(body, PREVIEW_CHARS),
    charCount,
    lineCount,
  });
};

const cappedError = ({ code, message, hint }: MediaError): MediaError => ({
  code,
  message: excerptOf(message, MAX_FAILURE_TEXT_CHARS),
  ...omitUndefined({
    hint:
      hint === undefined ? undefined : excerptOf(hint, MAX_FAILURE_TEXT_CHARS),
  }),
});

const failureSize = ({ url, inputUrl, error }: FailedEntry): number =>
  url.length +
  inputUrl.length +
  error.message.length +
  (error.hint?.length ?? 0);

const costOf = (entry: UrlEntry<Transcript>) => {
  if (!entry.ok) {
    const capped = { ...entry, error: cappedError(entry.error) };
    return {
      entry,
      size: failureSize(entry),
      overflowCost: failureSize(capped),
    };
  }
  const size = entry.value.text.length;
  const overflowCost =
    Math.min(size, PREVIEW_CHARS) + FILE_ENTRY_OVERHEAD_CHARS;
  return { entry, size, overflowCost };
};

const deliverFailure = (entry: FailedEntry, fits: boolean): FailedEntry =>
  fits ? entry : { ...entry, error: cappedError(entry.error) };

const deliverEntry =
  (directory: DirectoryVerifier, timestamps: boolean) =>
  async ({
    entry,
    fits,
  }: {
    entry: UrlEntry<Transcript>;
    fits: boolean;
  }): Promise<UrlEntry<TranscriptDelivery>> => {
    if (!entry.ok) return deliverFailure(entry, fits);
    const delivered = fits
      ? ok<TranscriptDelivery>({ ...entry.value, mode: "inline" })
      : await deliverAsFile(entry.value, directory, timestamps);
    return withValue(entry, delivered);
  };

export const deliverTranscripts = (
  entries: UrlEntry<Transcript>[],
  { outputRoot, budget, timestamps }: DeliveryOptions,
): Promise<UrlEntry<TranscriptDelivery>[]> => {
  const directory = transcriptDirectory(outputRoot);
  const budgeted = applyBudget(entries.map(costOf), budget);
  return Promise.all(budgeted.map(deliverEntry(directory, timestamps)));
};
