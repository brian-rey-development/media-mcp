import pLimit, { type LimitFunction } from "p-limit";
import type { MediaError } from "../domain/errors.js";
import { cancelled } from "../domain/result.js";
import type { Clock } from "./clock.js";
import type { ProcessRunner } from "./process.js";
import { createRateLimitGate, type RateLimitGate } from "./rate-limit-gate.js";

const DOWNLOAD_CONCURRENCY = 2;

interface ProcessPools {
  requests: ProcessRunner;
  downloads: ProcessRunner;
}

interface PoolOptions {
  run: ProcessRunner;
  concurrency: number;
  clock: Clock;
  random: () => number;
  isRateLimitFailure: (error: MediaError) => boolean;
}

const guarded =
  (
    run: ProcessRunner,
    limit: LimitFunction,
    gate: RateLimitGate,
  ): ProcessRunner =>
  (command, args, options) =>
    limit(() =>
      gate.guard(
        async () =>
          options.signal?.aborted ? cancelled() : run(command, args, options),
        options.signal,
      ),
    );

export const createProcessPools = ({
  run,
  concurrency,
  clock,
  random,
  isRateLimitFailure,
}: PoolOptions): ProcessPools => {
  const gate = createRateLimitGate({ clock, random, isRateLimitFailure });
  return {
    requests: guarded(run, pLimit(concurrency), gate),
    downloads: guarded(run, pLimit(DOWNLOAD_CONCURRENCY), gate),
  };
};
