import { createDiskCache } from "./infra/cache.js";
import { type Clock, systemClock } from "./infra/clock.js";
import type { Config } from "./infra/config.js";
import type { ProcessRunner } from "./infra/process.js";
import { createProcessPools } from "./infra/process-pools.js";
import type { Provider } from "./providers/provider.js";
import { createRegistry } from "./providers/registry.js";
import { createYoutubeProvider } from "./providers/youtube/provider.js";
import { isRateLimitFailure } from "./providers/ytdlp/failures.js";
import { failWhenUnplayable } from "./providers/ytdlp/unplayable.js";
import { createServices } from "./services/index.js";
import type { Services } from "./services/types.js";

interface MediaServicesDeps {
  run: ProcessRunner;
  clock?: Clock;
  random?: () => number;
  providers?: readonly Provider[];
}

type ResolvedDeps = Required<MediaServicesDeps>;

const youtubeProvider = (
  config: Config,
  { run, clock, random }: ResolvedDeps,
): Provider => {
  const pools = createProcessPools({
    run: failWhenUnplayable(run),
    concurrency: config.concurrency,
    clock,
    random,
    isRateLimitFailure,
  });
  return createYoutubeProvider({
    run: pools.requests,
    downloadRun: pools.downloads,
    config,
  });
};

export const createMediaServices = (
  config: Config,
  {
    run,
    clock = systemClock,
    random = Math.random,
    providers = [],
  }: MediaServicesDeps,
): Services => {
  const deps = { run, clock, random, providers };
  return createServices({
    registry: createRegistry([youtubeProvider(config, deps), ...providers]),
    cache: createDiskCache(config.cacheDir, clock),
    config,
    clock,
  });
};
