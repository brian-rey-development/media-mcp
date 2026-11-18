import { type DownloadResult, MEDIA_KINDS, QUALITIES } from "@media-mcp/core";
import { z } from "zod";
import { defineTool } from "../define-tool.js";
import {
  type BatchOutput,
  batchOutputShape,
  maxItemsField,
  startIndexField,
  successFields,
  toBatchOutput,
  urlsField,
} from "./batch-output.js";
import { renderBatch } from "./batch-text.js";
import { DEFAULT_DOWNLOAD_MAX_ITEMS } from "./limits.js";
import { createDownloadProgress } from "./progress.js";

const DEFAULT_QUALITY = "1080p";
export const MAX_OUTPUT_DIR_LENGTH = 2_048;
const BYTES_PER_KIB = 1024;
const SIZE_UNITS = ["bytes", "KiB", "MiB", "GiB"] as const;

const downloadedFileSchema = z.object({
  ...successFields,
  filePath: z.string().describe("Absolute path of the downloaded file"),
  kind: z.enum(MEDIA_KINDS).describe("Whether the file holds video or audio"),
  bytes: z.number().describe("Size of the file in bytes"),
});

export type DownloadedFile = z.infer<typeof downloadedFileSchema>;

const formatSize = (bytes: number): string => {
  const largest = SIZE_UNITS.length - 1;
  const unit =
    bytes < BYTES_PER_KIB
      ? 0
      : Math.min(
          Math.floor(Math.log(bytes) / Math.log(BYTES_PER_KIB)),
          largest,
        );
  const size = bytes / BYTES_PER_KIB ** unit;
  return `${unit === 0 ? size : size.toFixed(1)} ${SIZE_UNITS[unit]}`;
};

const toDownloadFields = ({ filePath, kind, bytes }: DownloadResult) => ({
  filePath,
  kind,
  bytes,
});

const renderFile = (file: DownloadedFile): string =>
  `Saved ${file.kind} to ${file.filePath} (${formatSize(file.bytes)})`;

const renderDownloads = (output: BatchOutput<DownloadedFile>): string =>
  renderBatch(output, renderFile, "\n");

export const downloadMedia = defineTool({
  name: "download_media",
  title: "Download media",
  description: `Download online videos as mp4 files, or only their audio as m4a, into the configured output folder. Use this only when the user needs the media file itself, because get_transcripts is much faster and lighter when you just need to read what is said. Returns one entry per video with the saved file path, marked ok or failed, so one failure never hides the others. The whole call is capped at maxItems, ${DEFAULT_DOWNLOAD_MAX_ITEMS} by default, and the result reports what was cut off with the real totals. Files are large and downloads of many videos take minutes, so ask before downloading many. Progress is reported while they run, except to a call that joins a download of the same video, kind, quality and folder that is already running, which gets its result without progress of its own.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  input: {
    urls: urlsField("to download"),
    kind: z
      .enum(MEDIA_KINDS)
      .describe("video for an mp4 file, audio for an m4a audio track only"),
    quality: z
      .enum(QUALITIES)
      .default(DEFAULT_QUALITY)
      .describe(
        `Highest video resolution to download. Ignored when kind is audio. Defaults to ${DEFAULT_QUALITY}.`,
      ),
    outputDir: z
      .string()
      .max(MAX_OUTPUT_DIR_LENGTH)
      .optional()
      .describe(
        "Folder inside the configured output root to save into, created when missing. Paths that leave the root are rejected. Defaults to the root itself.",
      ),
    maxItems: maxItemsField(DEFAULT_DOWNLOAD_MAX_ITEMS),
    startIndex: startIndexField,
  },
  output: batchOutputShape(downloadedFileSchema),
  render: renderDownloads,
  handler: async (
    { outputDir, ...rest },
    { services, signal, reportProgress },
  ) => {
    const progress = createDownloadProgress(reportProgress);
    const outcome = await services.downloads.run(
      {
        ...rest,
        ...(outputDir !== undefined && { outputDir }),
        onPlan: progress.plan,
        onProgress: progress.update,
      },
      signal,
    );
    if (!signal.aborted) progress.finish();
    return toBatchOutput(outcome, toDownloadFields);
  },
});
