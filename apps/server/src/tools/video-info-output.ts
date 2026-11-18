import type { VideoInfo } from "@media-mcp/core";
import { z } from "zod";
import {
  batchOutputShape,
  type EntryFields,
  successFields,
  videoLabelFields,
} from "./batch-output.js";

export const MAX_DESCRIPTION_CHARS = 2_000;
export const MAX_CHAPTERS_IN_OUTPUT = 200;

const chapterSchema = z.object({
  title: z.string().describe("The chapter title"),
  startSeconds: z.number().describe("Where the chapter starts, in seconds"),
});

const captionLanguagesSchema = z.object({
  manual: z
    .array(z.string())
    .readonly()
    .describe("Languages with captions written by hand, usable as language"),
  auto: z
    .array(z.string())
    .readonly()
    .describe("Languages with auto-generated captions of the original speech"),
});

const videoInfoSchema = z.object({
  ...successFields,
  ...videoLabelFields,
  durationSeconds: z
    .number()
    .optional()
    .describe("Length of the video, in seconds, absent for live streams"),
  description: z
    .string()
    .optional()
    .describe(
      `The description written by the uploader, cut at ${MAX_DESCRIPTION_CHARS} characters, present only when includeDescription is true`,
    ),
  descriptionTruncated: z
    .boolean()
    .optional()
    .describe("True when description was cut short, present with description"),
  chapters: z
    .array(chapterSchema)
    .describe(
      `The video's chapters in order, empty when it has none, at most the first ${MAX_CHAPTERS_IN_OUTPUT}`,
    ),
  chaptersTruncated: z
    .boolean()
    .optional()
    .describe(
      "True when the video has more chapters than chapters lists, absent otherwise",
    ),
  captionLanguages: captionLanguagesSchema.describe(
    "The caption languages the video offers, as accepted by get_transcripts",
  ),
});

export type VideoInfoEntry = z.infer<typeof videoInfoSchema>;
type VideoInfoFields = EntryFields<VideoInfoEntry>;

export const videoInfoOutputShape = batchOutputShape(videoInfoSchema);

const descriptionFields = (description: string) => {
  const points = Array.from(description);
  const truncated = points.length > MAX_DESCRIPTION_CHARS;
  return {
    description: truncated
      ? points.slice(0, MAX_DESCRIPTION_CHARS).join("")
      : description,
    descriptionTruncated: truncated,
  };
};

export const toInfoFields = (
  info: VideoInfo,
  includeDescription: boolean,
): VideoInfoFields => ({
  title: info.title,
  ...(info.channel !== undefined && { channel: info.channel }),
  ...(info.durationSeconds !== undefined && {
    durationSeconds: info.durationSeconds,
  }),
  ...(includeDescription && descriptionFields(info.description)),
  chapters: info.chapters.slice(0, MAX_CHAPTERS_IN_OUTPUT),
  ...(info.chapters.length > MAX_CHAPTERS_IN_OUTPUT && {
    chaptersTruncated: true,
  }),
  captionLanguages: info.captionLanguages,
});
