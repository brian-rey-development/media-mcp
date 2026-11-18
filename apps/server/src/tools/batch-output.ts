import {
  type BatchOutcome,
  describes,
  ERROR_CODES,
  MAX_URL_LENGTH,
  type MediaError,
  redactPaths,
  type Truncation,
  type VideoRef,
} from "@media-mcp/core";
import { z } from "zod";
import {
  FIRST_START_INDEX,
  MAX_ITEMS,
  MAX_START_INDEX,
  MIN_ITEMS,
} from "./limits.js";

export const urlsField = (purpose: string) =>
  z
    .array(z.string().max(MAX_URL_LENGTH))
    .min(MIN_ITEMS)
    .max(MAX_ITEMS)
    .describe(
      `Video or playlist links ${purpose}. Between 1 and ${MAX_ITEMS} links per call. A playlist link expands to its videos, and the whole call is capped by maxItems. Several links to one video are merged into one entry. A video link that also carries a list parameter counts as that single video, while a link to the playlist itself expands to every video in it.`,
    );

export const maxItemsField = (defaultValue: number) =>
  z
    .number()
    .int()
    .min(MIN_ITEMS)
    .max(MAX_ITEMS)
    .default(defaultValue)
    .describe(
      `Most videos processed in the whole call, counting every link and every playlist entry in order. Defaults to ${defaultValue}, maximum ${MAX_ITEMS}. Anything cut off is listed under truncations with its real total.`,
    );

export const startIndexField = z
  .number()
  .int()
  .min(FIRST_START_INDEX)
  .max(MAX_START_INDEX)
  .default(FIRST_START_INDEX)
  .describe(
    "Position of the first video to take from each playlist link, counting from 1. Use the value a truncation tells you to continue a long playlist in another call. Single video links ignore it.",
  );

export const successFields = {
  url: z.string().describe("The canonical link of the video"),
  inputUrl: z
    .string()
    .describe("The link as the caller passed it, which may differ from url"),
  ok: z.literal(true).describe("True when this video was handled"),
  videoId: z.string().describe("The provider's id for the video"),
};

export const videoLabelFields = {
  title: z.string().describe("The video title"),
  channel: z
    .string()
    .optional()
    .describe("The channel that published the video, absent when unknown"),
};

const failedEntrySchema = z.object({
  url: z.string().describe("The link that failed"),
  inputUrl: z.string().describe("The link as the caller passed it"),
  ok: z.literal(false).describe("False when this item failed"),
  error: z.object({
    code: z.enum(ERROR_CODES).describe("Machine-readable failure kind"),
    message: z.string().describe("What went wrong"),
    hint: z.string().optional().describe("What to do about it"),
  }),
});

const truncationSchema = describes<Truncation>()(
  z.object({
    source: z
      .string()
      .describe(
        "The link that was cut short, left out or had no videos in the requested window",
      ),
    included: z.number().describe("How many of its videos were processed"),
    totalExact: z
      .boolean()
      .describe("False when total is only a lower bound or unknown"),
    total: z
      .number()
      .optional()
      .describe(
        "How many videos the link has, absent when it was not expanded",
      ),
    nextStartIndex: z
      .number()
      .optional()
      .describe("The startIndex that continues where this call stopped"),
  }),
);

export type EntryFields<Entry> = Entry extends unknown
  ? Omit<Entry, keyof z.infer<z.ZodObject<typeof successFields>>>
  : never;

export type FailedEntry = z.infer<typeof failedEntrySchema>;
export type TruncationEntry = z.infer<typeof truncationSchema>;

export interface BatchOutput<Success> {
  entries: (Success | FailedEntry)[];
  truncations: TruncationEntry[];
}

export const batchOutputShape = <Success extends z.ZodType>(
  success: Success,
) => ({
  entries: z
    .array(z.union([success, failedEntrySchema]))
    .describe("One entry per video, in input order, each marked ok or failed"),
  truncations: z
    .array(truncationSchema)
    .describe(
      "Links that had more videos than maxItems, were left out, or had no videos in the requested window",
    ),
});

type Outcome<T> = BatchOutcome<T>["entries"][number];

export const toWireError = ({
  code,
  message,
  hint,
}: MediaError): FailedEntry["error"] => ({
  code,
  message: redactPaths(message),
  ...(hint !== undefined && { hint: redactPaths(hint) }),
});

const toWireEntry = <T extends { ref: VideoRef }, Fields extends object>(
  entry: Outcome<T>,
  fields: (value: T) => Fields,
) => {
  const address = { url: entry.url, inputUrl: entry.inputUrl };
  if (!entry.ok) {
    return { ...address, ok: false as const, error: toWireError(entry.error) };
  }
  const { value } = entry;
  const video = { ok: true as const, videoId: value.ref.id };
  return { ...address, ...video, ...fields(value) };
};

export const toBatchOutput = <
  T extends { ref: VideoRef },
  Fields extends object,
>(
  outcome: BatchOutcome<T>,
  fields: (value: T) => Fields,
) => ({
  entries: outcome.entries.map((entry) => toWireEntry(entry, fields)),
  truncations: outcome.truncations,
});
