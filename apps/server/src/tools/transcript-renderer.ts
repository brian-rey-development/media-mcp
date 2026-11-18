import { PREVIEW_CHARS, UNTRUSTED_NOTICE } from "@media-mcp/core";
import { renderBatch } from "./batch-text.js";
import type { TranscriptEntry, TranscriptOutput } from "./transcript-output.js";
import { quoted, titleWithChannel, wrapUntrusted } from "./untrusted.js";

const header = (item: TranscriptEntry): string => {
  const facts = `${item.language}, ${item.source}, ${item.wordCount} words`;
  return `## ${titleWithChannel(item)} (${facts})\n${item.url}\n${UNTRUSTED_NOTICE}`;
};

const body = (item: TranscriptEntry): string => {
  if (item.mode === "inline") {
    return wrapUntrusted(item.text, {
      source: item.url,
      video_id: item.videoId,
    });
  }
  const saved = `Saved to ${item.filePath} (${item.charCount} chars, ${item.lineCount} lines).`;
  const advice = `Preview below is the first ${PREVIEW_CHARS} characters only. Read it with read_transcript_file, or with your file tools when the server runs on your machine.`;
  return `${saved} ${advice}\nPreview: ${quoted(item.preview)}`;
};

export const renderTranscripts = (output: TranscriptOutput): string =>
  renderBatch(output, (item) => `${header(item)}\n${body(item)}`);
