import type {
  DownloadOptions,
  DownloadResult,
  VerifiedDirectory,
  VideoRef,
} from "../domain/media.js";
import type { Result } from "../domain/result.js";
import { createDirectoryVerifier, resolveWithinRoot } from "../infra/paths.js";
import { failEveryUrl, type Target } from "./expand.js";
import { videoKey } from "./keys.js";
import { runRequest } from "./run-targets.js";
import type { Runtime } from "./runtime.js";
import type {
  BatchOutcome,
  DirectoryVerifier,
  DownloadRequest,
  Services,
} from "./types.js";

const optionsFor = (
  ref: VideoRef,
  { kind, quality, onProgress }: DownloadRequest,
  outputDir: VerifiedDirectory,
): DownloadOptions => ({
  kind,
  quality,
  outputDir,
  ...(onProgress && {
    onProgress: (percent: number) => onProgress(ref, percent),
  }),
});

// Two runs of the same file in one folder would share yt-dlp's partial files, and a failing one removes its leftovers.
const flightKey = (
  ref: VideoRef,
  { kind, quality }: DownloadRequest,
  outputDir: VerifiedDirectory,
): string =>
  [videoKey(ref), kind, kind === "audio" ? "" : quality, outputDir].join("|");

const downloadTarget = async (
  { downloads }: Runtime,
  request: DownloadRequest,
  directory: DirectoryVerifier,
  { provider, ref }: Target,
  signal?: AbortSignal,
): Promise<Result<DownloadResult>> => {
  const outputDir = await directory();
  if (!outputDir.ok) return outputDir;
  const options = optionsFor(ref, request, outputDir.value);
  return downloads.run(
    flightKey(ref, request, outputDir.value),
    () => provider.download(ref, options, signal),
    signal,
  );
};

const runDownloads = async (
  runtime: Runtime,
  request: DownloadRequest,
  signal?: AbortSignal,
): Promise<BatchOutcome<DownloadResult>> => {
  const { outputRoot } = runtime.config;
  const planned = await resolveWithinRoot(outputRoot, request.outputDir);
  if (!planned.ok) return failEveryUrl(request.urls, planned);
  const directory = createDirectoryVerifier(outputRoot, request.outputDir);
  return runRequest(
    runtime,
    request,
    (target) => downloadTarget(runtime, request, directory, target, signal),
    signal,
  );
};

export const createDownloadService = (
  runtime: Runtime,
): Services["downloads"] => ({
  run: (request, signal) => runDownloads(runtime, request, signal),
});
