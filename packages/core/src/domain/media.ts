export interface VideoRef {
  provider: string;
  id: string;
  url: string;
}

interface Chapter {
  title: string;
  startSeconds: number;
}

export interface CaptionLanguages {
  manual: readonly string[];
  auto: readonly string[];
}

export interface VideoInfo {
  ref: VideoRef;
  title: string;
  channel?: string | undefined;
  durationSeconds?: number | undefined;
  description: string;
  chapters: Chapter[];
  captionLanguages: CaptionLanguages;
}

export const CAPTION_SOURCES = ["manual", "auto"] as const;

export type CaptionSource = (typeof CAPTION_SOURCES)[number];

export interface Transcript {
  ref: VideoRef;
  title: string;
  channel?: string | undefined;
  language: string;
  source: CaptionSource;
  text: string;
  wordCount: number;
}

export const QUALITIES = ["best", "1080p", "720p", "480p", "360p"] as const;

export type Quality = (typeof QUALITIES)[number];

export const MEDIA_KINDS = ["video", "audio"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

declare const verifiedDirectory: unique symbol;

export type VerifiedDirectory = string & {
  readonly [verifiedDirectory]: true;
};

export interface DownloadOptions {
  kind: MediaKind;
  quality: Quality;
  outputDir: VerifiedDirectory;
  onProgress?: (percent: number) => void;
}

export interface DownloadResult {
  ref: VideoRef;
  filePath: string;
  kind: MediaKind;
  bytes: number;
}
