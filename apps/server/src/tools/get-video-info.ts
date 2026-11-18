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
import { UNTRUSTED_GUIDANCE } from "./untrusted.js";
import {
  MAX_DESCRIPTION_CHARS,
  toInfoFields,
  videoInfoOutputShape,
} from "./video-info-output.js";
import { renderVideoInfo } from "./video-info-renderer.js";

export const getVideoInfo = defineTool({
  name: "get_video_info",
  title: "Get video info",
  description: `Get the title, channel, duration, chapters and caption languages of online videos, and optionally the description. Use this first to outline a video or to decide which videos deserve a transcript, and to find chapters, since they are the best natural outline for study notes. Accepts several video links or a playlist link and returns one entry per video marked ok or failed, so one unavailable video never hides the others. The caption languages tell you which language codes get_transcripts accepts for each video. Descriptions can be long, so they are left out unless you set includeDescription, and then they are cut at ${MAX_DESCRIPTION_CHARS} characters and flagged when cut. Large batches that are not cached yet take minutes, and progress is reported while they run. ${UNTRUSTED_GUIDANCE}`,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  input: {
    urls: urlsField("to look up"),
    maxItems: maxItemsField(DEFAULT_READ_MAX_ITEMS),
    startIndex: startIndexField,
    includeDescription: z
      .boolean()
      .default(false)
      .describe(
        `Also return each video's description, cut at ${MAX_DESCRIPTION_CHARS} characters. Off by default.`,
      ),
  },
  output: videoInfoOutputShape,
  render: renderVideoInfo,
  handler: async (
    { urls, maxItems, startIndex, includeDescription },
    { services, signal, reportProgress },
  ) => {
    const progress = createCountProgress(reportProgress);
    const outcome = await services.info.fetch(
      {
        urls,
        maxItems,
        startIndex,
        onPlan: progress.plan,
        onItemDone: progress.itemDone,
      },
      signal,
    );
    return toBatchOutput(outcome, (info) =>
      toInfoFields(info, includeDescription),
    );
  },
});
