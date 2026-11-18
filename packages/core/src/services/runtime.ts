import type { DownloadResult, Transcript, VideoInfo } from "../domain/media.js";
import type { Cache } from "../infra/cache.js";
import type { Config } from "../infra/config.js";
import { MS_PER_DAY, MS_PER_MINUTE } from "../infra/units.js";
import type { Resolved } from "../providers/provider.js";
import type { Registry } from "../providers/registry.js";
import { type CachedLoader, createCachedLoader } from "./cached.js";
import { createMemoryCache } from "./memory-cache.js";
import {
  ResolvedSchema,
  TranscriptSchema,
  VideoInfoSchema,
} from "./schemas.js";
import { createSingleFlight, type SingleFlight } from "./single-flight.js";
import type { ServiceDeps } from "./types.js";

const RESOLUTION_TTL_MINUTES = 5;
const RESOLUTION_TTL_MS = RESOLUTION_TTL_MINUTES * MS_PER_MINUTE;
const AUTO_TRANSCRIPT_TTL_DAYS = 7;
const AUTO_TRANSCRIPT_TTL_MS = AUTO_TRANSCRIPT_TTL_DAYS * MS_PER_DAY;

export interface Runtime {
  registry: Registry;
  config: Config;
  info: CachedLoader<VideoInfo>;
  transcripts: CachedLoader<Transcript>;
  resolutions: CachedLoader<Resolved>;
  downloads: SingleFlight<DownloadResult>;
}

const transcriptTtl =
  ({ transcriptTtlMs }: Config) =>
  ({ source }: Transcript): number =>
    source === "auto"
      ? Math.min(transcriptTtlMs, AUTO_TRANSCRIPT_TTL_MS)
      : transcriptTtlMs;

const transcriptLoader = (
  cache: Cache,
  config: Config,
): CachedLoader<Transcript> =>
  createCachedLoader(cache, TranscriptSchema, transcriptTtl(config));

export const createRuntime = ({
  registry,
  cache,
  config,
  clock,
}: ServiceDeps): Runtime => ({
  registry,
  config,
  info: createCachedLoader(cache, VideoInfoSchema, () => config.infoTtlMs),
  transcripts: transcriptLoader(cache, config),
  resolutions: createCachedLoader(
    createMemoryCache(clock),
    ResolvedSchema,
    () => RESOLUTION_TTL_MS,
  ),
  downloads: createSingleFlight<DownloadResult>(),
});
