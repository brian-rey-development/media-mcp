import type {
  DownloadOptions,
  DownloadResult,
  Transcript,
  VideoInfo,
  VideoRef,
} from "../domain/media.js";
import type { Result } from "../domain/result.js";

export interface TranscriptOptions {
  language: string;
  timestamps: boolean;
}

export interface ResolveOptions {
  maxItems: number;
  startIndex: number;
}

export interface Resolved {
  refs: readonly VideoRef[];
  total: number;
  totalExact: boolean;
}

export interface Provider {
  readonly name: string;
  matches(url: string): boolean;
  resolve(
    url: string,
    options: ResolveOptions,
    signal?: AbortSignal,
  ): Promise<Result<Resolved>>;
  getInfo(ref: VideoRef, signal?: AbortSignal): Promise<Result<VideoInfo>>;
  getTranscript(
    ref: VideoRef,
    options: TranscriptOptions,
    signal?: AbortSignal,
  ): Promise<Result<Transcript>>;
  download(
    ref: VideoRef,
    options: DownloadOptions,
    signal?: AbortSignal,
  ): Promise<Result<DownloadResult>>;
}
