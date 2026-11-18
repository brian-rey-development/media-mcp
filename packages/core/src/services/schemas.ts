import { z } from "zod";
import {
  CAPTION_SOURCES,
  type Transcript,
  type VideoInfo,
  type VideoRef,
} from "../domain/media.js";
import { describes } from "../domain/types-check.js";
import type { Resolved } from "../providers/provider.js";

const RefSchema = describes<VideoRef>()(
  z.object({
    provider: z.string(),
    id: z.string(),
    url: z.string(),
  }),
);

export const ResolvedSchema = describes<Resolved>()(
  z.object({
    refs: z.array(RefSchema).readonly(),
    total: z.number(),
    totalExact: z.boolean(),
  }),
);

export const TranscriptSchema = describes<Transcript>()(
  z.object({
    ref: RefSchema,
    title: z.string(),
    channel: z.string().optional(),
    language: z.string(),
    source: z.enum(CAPTION_SOURCES),
    text: z.string(),
    wordCount: z.number(),
  }),
);

export const VideoInfoSchema = describes<VideoInfo>()(
  z.object({
    ref: RefSchema,
    title: z.string(),
    channel: z.string().optional(),
    durationSeconds: z.number().optional(),
    description: z.string(),
    chapters: z.array(
      z.object({ title: z.string(), startSeconds: z.number() }),
    ),
    captionLanguages: z.object({
      manual: z.array(z.string()).readonly(),
      auto: z.array(z.string()).readonly(),
    }),
  }),
);
