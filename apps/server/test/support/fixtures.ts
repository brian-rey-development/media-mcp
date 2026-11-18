import type { VideoInfo, VideoRef } from "@media-mcp/core";
import { MAX_ITEMS } from "../../src/tools/limits.js";

export const URL_A = "https://www.youtube.com/watch?v=vidAAAAAAAA";
export const URL_B = "https://www.youtube.com/watch?v=vidBBBBBBBB";
export const PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLx";

export const REF_A: VideoRef = {
  provider: "youtube",
  id: "vidAAAAAAAA",
  url: URL_A,
};
export const REF_B: VideoRef = {
  provider: "youtube",
  id: "vidBBBBBBBB",
  url: URL_B,
};

export const INJECTED_URLS = [
  "--exec=touch /tmp/pwned",
  "-o /etc/cron.d/x",
  "file:///etc/passwd",
  "javascript:alert(1)",
];

export const tooManyUrls = (): string[] =>
  Array.from({ length: MAX_ITEMS + 1 }, () => URL_A);

export const LECTURE: VideoInfo = {
  ref: REF_A,
  title: "A lecture",
  channel: "A channel",
  durationSeconds: 3_600,
  description: "About the lecture",
  chapters: [
    { title: "Intro", startSeconds: 0 },
    { title: "Proof", startSeconds: 600 },
  ],
  captionLanguages: { manual: ["en"], auto: ["es"] },
};
