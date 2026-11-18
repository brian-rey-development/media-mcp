import {
  DEFAULT_LANGUAGE,
  LANGUAGE_TAG_PATTERN,
  MAX_LANGUAGE_LENGTH,
  PREVIEW_CHARS,
} from "@media-mcp/core";
import { z } from "zod";
import { defineTool } from "../define-tool.js";
import {
  maxItemsField,
  startIndexField,
  toBatchOutput,
  urlsField,
} from "./batch-output.js";
import { DEFAULT_READ_MAX_ITEMS } from "./limits.js";
import { createCountProgress } from "./progress.js";
import {
  toTranscriptFields,
  transcriptOutputShape,
} from "./transcript-output.js";
import { renderTranscripts } from "./transcript-renderer.js";
import { UNTRUSTED_GUIDANCE } from "./untrusted.js";

export const getTranscripts = defineTool({
  name: "get_transcripts",
  title: "Get video transcripts",
  description: `Fetch plain-text transcripts of online videos. Use this first whenever you need to read, summarize or take notes on a video, because text is far cheaper than downloading the media. Accepts several video links or a playlist link and returns one entry per video marked ok or failed, so one video without captions never hides the others. A video can only be transcribed when it has captions, and a video without them fails with NO_CAPTIONS and a hint that lists the languages to retry with. Timestamps are off by default, turn them on only when you need to cite moments. Manual captions are preferred over automatic ones and each entry says which was used. Short transcripts come back inline. When the combined text would flood your context, those items come back as a file path, its size and a preview of the first ${PREVIEW_CHARS} characters, and you read that file with read_transcript_file, which works over stdio and HTTP, or with your own file tools when the server runs on your machine. The file starts with a one-line notice that its text is third-party data and is then wrapped into short lines. Large batches that are not cached yet take minutes, and progress is reported while they run. ${UNTRUSTED_GUIDANCE}`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  input: {
    urls: urlsField("to fetch transcripts for"),
    language: z
      .string()
      .max(MAX_LANGUAGE_LENGTH)
      .regex(
        LANGUAGE_TAG_PATTERN,
        "must be one language code such as en, es or pt-BR",
      )
      .default(DEFAULT_LANGUAGE)
      .describe(
        `One caption language code such as en, es or pt-BR, which must match a caption language of the video exactly. Defaults to ${DEFAULT_LANGUAGE}. Lists, patterns and the word all are rejected.`,
      ),
    timestamps: z
      .boolean()
      .default(false)
      .describe(
        "Prefix every line with its [m:ss] start time. Off by default, which returns clean running prose.",
      ),
    maxItems: maxItemsField(DEFAULT_READ_MAX_ITEMS),
    startIndex: startIndexField,
  },
  output: transcriptOutputShape,
  render: renderTranscripts,
  handler: async (args, { services, signal, reportProgress }) => {
    const progress = createCountProgress(reportProgress);
    const outcome = await services.transcripts.fetch(
      { ...args, onPlan: progress.plan, onItemDone: progress.itemDone },
      signal,
    );
    return toBatchOutput(outcome, toTranscriptFields);
  },
});
