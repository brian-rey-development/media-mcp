import type {
  DownloadResult,
  MediaKind,
  Quality,
  Transcript,
  VideoInfo,
  VideoRef,
} from "../domain/media.js";
import type { Result } from "../domain/result.js";
import type { Cache } from "../infra/cache.js";
import type { Clock } from "../infra/clock.js";
import type { Config } from "../infra/config.js";
import type { createDirectoryVerifier } from "../infra/paths.js";
import type {
  ResolveOptions,
  TranscriptOptions,
} from "../providers/provider.js";
import type { Registry } from "../providers/registry.js";

interface UrlAddress {
  url: string;
  inputUrl: string;
}

export type UrlEntry<T> = Result<T> & UrlAddress;

export const failedEntry = (
  url: string,
  failure: Result<never>,
): UrlEntry<never> => ({ url, inputUrl: url, ...failure });

export const withValue = <T>(
  { url, inputUrl }: UrlAddress,
  result: Result<T>,
): UrlEntry<T> => ({ url, inputUrl, ...result });

export type DirectoryVerifier = ReturnType<typeof createDirectoryVerifier>;

export interface Truncation {
  source: string;
  included: number;
  totalExact: boolean;
  total?: number | undefined;
  nextStartIndex?: number | undefined;
}

export interface BatchOutcome<T> {
  entries: UrlEntry<T>[];
  truncations: Truncation[];
}

export type TranscriptDelivery = Omit<Transcript, "text"> &
  (
    | { mode: "inline"; text: string }
    | {
        mode: "file";
        filePath: string;
        preview: string;
        charCount: number;
        lineCount: number;
      }
  );

export interface BatchRequest extends ResolveOptions {
  urls: readonly string[];
  onPlan?: (total: number) => void;
  onItemDone?: (ref: VideoRef) => void;
}

export interface TranscriptRequest extends BatchRequest, TranscriptOptions {}

export interface DownloadRequest extends BatchRequest {
  kind: MediaKind;
  quality: Quality;
  outputDir?: string;
  onProgress?: (ref: VideoRef, percent: number) => void;
}

export interface TranscriptPageRequest {
  path: string;
  startLine: number;
  maxLines: number;
}

export interface TranscriptPage {
  path: string;
  startLine: number;
  lineCount: number;
  totalLines: number;
  text: string;
  nextStartLine?: number;
}

export interface Services {
  transcripts: {
    fetch(
      request: TranscriptRequest,
      signal?: AbortSignal,
    ): Promise<BatchOutcome<TranscriptDelivery>>;
  };
  info: {
    fetch(
      request: BatchRequest,
      signal?: AbortSignal,
    ): Promise<BatchOutcome<VideoInfo>>;
  };
  downloads: {
    run(
      request: DownloadRequest,
      signal?: AbortSignal,
    ): Promise<BatchOutcome<DownloadResult>>;
  };
  transcriptFiles: {
    read(
      request: TranscriptPageRequest,
      signal?: AbortSignal,
    ): Promise<Result<TranscriptPage>>;
  };
}

export interface ServiceDeps {
  registry: Registry;
  cache: Cache;
  config: Config;
  clock: Clock;
}
