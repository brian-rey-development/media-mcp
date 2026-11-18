import { describe, expect, it, vi } from "vitest";
import type { MediaError } from "../src/domain/errors.js";
import { err, ok } from "../src/domain/result.js";
import type { Clock } from "../src/infra/clock.js";
import type { ProcessRunner, RunOptions } from "../src/infra/process.js";
import { createProcessPools } from "../src/infra/process-pools.js";
import { fakeClock } from "./support/fake-clock.js";

const REQUEST_CONCURRENCY = 3;
const DOWNLOAD_CONCURRENCY = 2;
const OPTIONS: RunOptions = { timeoutMs: 1_000 };
const THROTTLE_TEXT = "HTTP Error 429";

const isThrottle = (error: MediaError): boolean =>
  error.message.includes(THROTTLE_TEXT);

const throttled = () => err("PROCESS_FAILED", THROTTLE_TEXT);

const holdingRunner = () => {
  const release = Promise.withResolvers<void>();
  const running = { now: 0, peak: 0 };
  const run: ProcessRunner = async () => {
    running.now += 1;
    running.peak = Math.max(running.peak, running.now);
    await release.promise;
    running.now -= 1;
    return ok({ stdout: "", stderr: "" });
  };
  return { run, release, running };
};

const poolsOver = (run: ProcessRunner, clock: Clock = fakeClock().clock) =>
  createProcessPools({
    run,
    concurrency: REQUEST_CONCURRENCY,
    isRateLimitFailure: isThrottle,
    random: () => 0,
    clock,
  });

describe("createProcessPools", () => {
  describe("concurrency", () => {
    it("never runs more request processes at once than the limit", async () => {
      const { run, release, running } = holdingRunner();
      const { requests } = poolsOver(run);

      const all = Promise.all(
        Array.from({ length: 5 }, () => requests("tool", [], OPTIONS)),
      );
      await vi.waitFor(() => expect(running.now).toBe(REQUEST_CONCURRENCY));
      release.resolve();
      await all;

      expect(running.peak).toBe(REQUEST_CONCURRENCY);
    });

    it("keeps a saturated download pool from delaying request processes", async () => {
      const { run, release, running } = holdingRunner();
      const { requests, downloads } = poolsOver(run);
      const queuedDownloads = Array.from({ length: 4 }, () =>
        downloads("tool", [], OPTIONS),
      );
      await vi.waitFor(() => expect(running.now).toBe(DOWNLOAD_CONCURRENCY));
      const request = requests("tool", [], OPTIONS);

      await vi.waitFor(() =>
        expect(running.now).toBe(DOWNLOAD_CONCURRENCY + 1),
      );
      release.resolve();

      expect(running.peak).toBe(DOWNLOAD_CONCURRENCY + 1);
      expect((await request).ok).toBe(true);
      await Promise.all(queuedDownloads);
    });

    it("bounds downloads by their own limit", async () => {
      const { run, release, running } = holdingRunner();
      const { downloads } = poolsOver(run);

      const all = Promise.all(
        Array.from({ length: 4 }, () => downloads("tool", [], OPTIONS)),
      );
      await vi.waitFor(() => expect(running.now).toBe(DOWNLOAD_CONCURRENCY));
      release.resolve();
      await all;

      expect(running.peak).toBe(DOWNLOAD_CONCURRENCY);
    });
  });

  describe("cancellation", () => {
    it("reports CANCELLED without starting a process when the signal aborted while queued", async () => {
      const { run, release, running } = holdingRunner();
      const spy = vi.fn(run);
      const { downloads } = poolsOver(spy);
      const holding = Array.from({ length: DOWNLOAD_CONCURRENCY }, () =>
        downloads("tool", [], OPTIONS),
      );
      await vi.waitFor(() => expect(running.now).toBe(DOWNLOAD_CONCURRENCY));
      const controller = new AbortController();
      const queued = downloads("tool", [], {
        ...OPTIONS,
        signal: controller.signal,
      });

      controller.abort();
      release.resolve();

      expect(await queued).toMatchObject({
        ok: false,
        error: { code: "CANCELLED" },
      });
      expect(spy).toHaveBeenCalledTimes(DOWNLOAD_CONCURRENCY);
      await Promise.all(holding);
    });
  });

  describe("rate limiting", () => {
    it("fails later processes fast, in both pools, after a second throttle", async () => {
      const { clock } = fakeClock();
      const run = vi.fn<ProcessRunner>().mockResolvedValue(throttled());
      const { requests, downloads } = poolsOver(run, clock);
      await requests("tool", [], OPTIONS);
      run.mockClear();

      const results = await Promise.all([
        requests("tool", [], OPTIONS),
        downloads("tool", [], OPTIONS),
      ]);

      expect(run).not.toHaveBeenCalled();
      expect(results).toEqual([throttled(), throttled()]);
    });
  });
});
