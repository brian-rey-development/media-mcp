import type { ToolDefinition } from "../define-tool.js";
import { downloadMedia } from "./download-media.js";
import { getTranscripts } from "./get-transcripts.js";
import { getVideoInfo } from "./get-video-info.js";
import { readTranscriptFile } from "./read-transcript-file.js";

export const tools: readonly ToolDefinition[] = [
  getTranscripts,
  getVideoInfo,
  downloadMedia,
  readTranscriptFile,
];
