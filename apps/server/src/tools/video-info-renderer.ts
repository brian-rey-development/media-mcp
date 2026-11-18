import { formatTimestamp, UNTRUSTED_NOTICE } from "@media-mcp/core";
import type { BatchOutput } from "./batch-output.js";
import { renderBatch } from "./batch-text.js";
import { quoted, titleWithChannel, wrapUntrusted } from "./untrusted.js";
import {
  MAX_CHAPTERS_IN_OUTPUT,
  MAX_DESCRIPTION_CHARS,
  type VideoInfoEntry,
} from "./video-info-output.js";

export const MAX_CHAPTERS_IN_TEXT = 50;

const renderCaptions = ({
  manual,
  auto,
}: VideoInfoEntry["captionLanguages"]) => {
  const parts = [
    manual.length > 0 ? `manual ${manual.join(" ")}` : undefined,
    auto.length > 0 ? `auto ${auto.join(" ")}` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? `captions ${parts.join(", ")}` : "no captions";
};

const renderSummary = (video: VideoInfoEntry): string => {
  const parts = [
    titleWithChannel(video),
    video.durationSeconds === undefined
      ? undefined
      : formatTimestamp(video.durationSeconds),
    `${video.chapters.length}${video.chaptersTruncated ? "+" : ""} chapters`,
    renderCaptions(video.captionLanguages),
    video.url,
  ];
  return parts.filter((part) => part !== undefined).join(", ");
};

const renderChapter = ({
  title,
  startSeconds,
}: VideoInfoEntry["chapters"][number]): string =>
  `${formatTimestamp(startSeconds)} ${quoted(title)}`;

const chapterNotices = (
  { chaptersTruncated }: VideoInfoEntry,
  hidden: number,
): string[] => [
  ...(hidden > 0 ? [`${hidden} more chapters not shown`] : []),
  ...(chaptersTruncated
    ? [
        `The video has more chapters, only the first ${MAX_CHAPTERS_IN_OUTPUT} are returned`,
      ]
    : []),
];

const renderChapters = (video: VideoInfoEntry): string[] => {
  const { chapters } = video;
  if (chapters.length === 0) return [];
  const shown = chapters.slice(0, MAX_CHAPTERS_IN_TEXT).map(renderChapter);
  const hidden = chapters.length - shown.length;
  return ["Chapters:", ...shown, ...chapterNotices(video, hidden)];
};

const renderDescription = (video: VideoInfoEntry): string[] => {
  const { description, descriptionTruncated } = video;
  if (description === undefined) return [];
  if (description === "") return ["Description: none"];
  const heading = descriptionTruncated
    ? `Description, cut at ${MAX_DESCRIPTION_CHARS} characters:`
    : "Description:";
  const source = { source: video.url, video_id: video.videoId };
  return [heading, wrapUntrusted(description, source)];
};

const renderVideo = (video: VideoInfoEntry): string =>
  [
    renderSummary(video),
    ...renderChapters(video),
    ...renderDescription(video),
  ].join("\n");

export const renderVideoInfo = (output: BatchOutput<VideoInfoEntry>): string =>
  `${UNTRUSTED_NOTICE}\n${renderBatch(output, renderVideo)}`;
