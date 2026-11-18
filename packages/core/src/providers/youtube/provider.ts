import type {
  DownloadOptions,
  DownloadResult,
  Transcript,
  VideoInfo,
  VideoRef,
} from "../../domain/media.js";
import { ok, type Result } from "../../domain/result.js";
import type { Config } from "../../infra/config.js";
import type { ProcessRunner } from "../../infra/process.js";
import type {
  Provider,
  Resolved,
  ResolveOptions,
  TranscriptOptions,
} from "../provider.js";
import { downloadMedia } from "../ytdlp/download.js";
import type { YtDlpDeps } from "../ytdlp/exec.js";
import { fetchInfo, toVideoInfo } from "../ytdlp/info.js";
import { listPlaylist } from "../ytdlp/playlist.js";
import { fetchTranscript } from "../ytdlp/transcript.js";
import { PROVIDER_NAME, youtubeRef } from "./refs.js";
import {
  canonicalPlaylistUrl,
  isYoutubeHost,
  parseYoutubeUrl,
  videoUrlOf,
} from "./urls.js";

const resolvePlaylist = async (
  deps: YtDlpDeps,
  id: string,
  options: ResolveOptions,
  signal?: AbortSignal,
): Promise<Result<Resolved>> => {
  const listing = await listPlaylist(
    deps,
    canonicalPlaylistUrl(id),
    options,
    signal,
  );
  if (!listing.ok) return listing;
  const { ids, total, totalExact } = listing.value;
  return ok({ refs: ids.map(youtubeRef), total, totalExact });
};

const resolveUrl = async (
  deps: YtDlpDeps,
  url: string,
  options: ResolveOptions,
  signal?: AbortSignal,
): Promise<Result<Resolved>> => {
  const target = parseYoutubeUrl(url);
  if (!target.ok) return target;
  if (target.value.kind === "video") {
    const refs = [youtubeRef(target.value.id)];
    return ok({ refs, total: 1, totalExact: true });
  }
  return resolvePlaylist(deps, target.value.id, options, signal);
};

const withVideoUrl = async <T>(
  ref: VideoRef,
  use: (url: string) => Promise<Result<T>>,
): Promise<Result<T>> => {
  const url = videoUrlOf(ref.id);
  return url.ok ? use(url.value) : url;
};

const getInfo = (
  deps: YtDlpDeps,
  ref: VideoRef,
  signal?: AbortSignal,
): Promise<Result<VideoInfo>> =>
  withVideoUrl(ref, async (url) => {
    const info = await fetchInfo(deps, url, signal);
    return info.ok ? ok(toVideoInfo(info.value, ref)) : info;
  });

const getTranscript = (
  deps: YtDlpDeps,
  ref: VideoRef,
  options: TranscriptOptions,
  signal?: AbortSignal,
): Promise<Result<Transcript>> =>
  withVideoUrl(ref, (url) => fetchTranscript(deps, url, ref, options, signal));

const download = (
  deps: YtDlpDeps,
  ref: VideoRef,
  options: DownloadOptions,
  signal?: AbortSignal,
): Promise<Result<DownloadResult>> =>
  withVideoUrl(ref, (url) => downloadMedia(deps, url, ref, options, signal));

interface YoutubeProviderOptions {
  run: ProcessRunner;
  downloadRun: ProcessRunner;
  config: Config;
}

export const createYoutubeProvider = ({
  run,
  downloadRun,
  config,
}: YoutubeProviderOptions): Provider => {
  const deps: YtDlpDeps = { run, config };
  const downloadDeps: YtDlpDeps = { run: downloadRun, config };
  return {
    name: PROVIDER_NAME,
    matches: isYoutubeHost,
    resolve: (url, options, signal) => resolveUrl(deps, url, options, signal),
    getInfo: (ref, signal) => getInfo(deps, ref, signal),
    getTranscript: (ref, options, signal) =>
      getTranscript(deps, ref, options, signal),
    download: (ref, options, signal) =>
      download(downloadDeps, ref, options, signal),
  };
};
