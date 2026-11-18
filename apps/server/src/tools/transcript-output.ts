import { CAPTION_SOURCES, type TranscriptDelivery } from "@media-mcp/core";
import { z } from "zod";
import {
  type BatchOutput,
  batchOutputShape,
  type EntryFields,
  successFields,
  videoLabelFields,
} from "./batch-output.js";

const videoFields = {
  ...successFields,
  ...videoLabelFields,
  language: z.string().describe("The caption language that was used"),
  source: z
    .enum(CAPTION_SOURCES)
    .describe("Whether the captions were written by hand or auto-generated"),
  wordCount: z.number().describe("Spoken words, without timestamp markers"),
};

const inlineTranscriptSchema = z.object({
  ...videoFields,
  mode: z.literal("inline").describe("The text is included in this entry"),
  text: z.string().describe("The full transcript"),
});

const fileTranscriptSchema = z.object({
  ...videoFields,
  mode: z.literal("file").describe("The text was saved to a file instead"),
  filePath: z
    .string()
    .describe(
      "Absolute path of the saved transcript, which starts with a one-line notice that its text is third-party data, then the transcript one short line at a time. Pass it to read_transcript_file to read it in pages",
    ),
  preview: z.string().describe("The first characters of the saved text"),
  charCount: z.number().describe("Characters in the saved file"),
  lineCount: z.number().describe("Lines in the saved file"),
});

const transcriptSchema = z.union([
  inlineTranscriptSchema,
  fileTranscriptSchema,
]);

export type TranscriptEntry = z.infer<typeof transcriptSchema>;
export type TranscriptOutput = BatchOutput<TranscriptEntry>;
type TranscriptFields = EntryFields<TranscriptEntry>;

export const transcriptOutputShape = batchOutputShape(transcriptSchema);

const commonFields = (delivery: TranscriptDelivery) => ({
  title: delivery.title,
  language: delivery.language,
  source: delivery.source,
  wordCount: delivery.wordCount,
  ...(delivery.channel !== undefined && { channel: delivery.channel }),
});

const deliveryFields = (delivery: TranscriptDelivery) =>
  delivery.mode === "inline"
    ? { mode: delivery.mode, text: delivery.text }
    : {
        mode: delivery.mode,
        filePath: delivery.filePath,
        preview: delivery.preview,
        charCount: delivery.charCount,
        lineCount: delivery.lineCount,
      };

export const toTranscriptFields = (
  delivery: TranscriptDelivery,
): TranscriptFields => ({
  ...commonFields(delivery),
  ...deliveryFields(delivery),
});
