import { describe, expect, it, vi } from "vitest";
import type { MediaError } from "../src/domain/errors.js";
import { err, ok, type Result } from "../src/domain/result.js";
import type { Clock } from "../src/infra/clock.js";
import { createRateLimitGate } from "../src/infra/rate-limit-gate.js";
import { fakeClock } from "./support/fake-clock.js";

const BASE_MS = 2_000;
const DOUBLE_BACKOFF_MS = 2 * BASE_MS;
const FAIL_FAST_WINDOW_MS = 60_000;
const LIMIT_HINT = "Wait a while before retrying";

const limited = (): Result<never> =>
  err("RATE_LIMITED", "Too many requests", LIMIT_HINT);

const isRateLimitCode = (error: MediaError): boolean =>
  error.code === "RATE_LIMITED";

const gateWith = (random = () => 0, until?: Promise<void>) => {
  const fake = fakeClock(until);
  return {
    ...fake,
    gate: createRateLimitGate({
      clock: fake.clock,
      random,
      isRateLimitFailure: isRateLimitCode,
    }),
  };
};

const outcomes = (...results: Result<string>[]) => {
  const queue = [...results];
  return vi.fn(async () => queue.shift() ?? ok("done"));
};

describe("createRateLimitGate", () => {
  it("passes a result through without waiting", async () => {
    const { gate, state } = gateWith();

    const result = await gate.guard(outcomes(ok("fine")));

    expect(result).toEqual(ok("fine"));
    expect(state.slept).toEqual([]);
  });

  it("pauses, then retries a rate limited item once and returns the retry", async () => {
    const { gate, state } = gateWith();
    const task = outcomes(limited(), ok("second try"));

    const result = await gate.guard(task);

    expect(result).toEqual(ok("second try"));
    expect(task).toHaveBeenCalledTimes(2);
    expect(state.slept).toEqual([BASE_MS]);
  });

  it("adds jitter on top of the back-off", async () => {
    const { gate, state } = gateWith(() => 1);

    await gate.guard(outcomes(limited(), ok("x")));

    expect(state.slept).toEqual([BASE_MS * 1.25]);
  });

  it("does not retry other failures", async () => {
    const { gate } = gateWith();
    const task = outcomes(err("NO_CAPTIONS", "none"));

    const result = await gate.guard(task);

    expect(result).toMatchObject({ ok: false, error: { code: "NO_CAPTIONS" } });
    expect(task).toHaveBeenCalledOnce();
  });

  it("fails the remaining items fast with the original hint after a second limit", async () => {
    const { gate } = gateWith();
    await gate.guard(outcomes(limited(), limited()));
    const later = outcomes(ok("never runs"));

    const result = await gate.guard(later);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED", hint: LIMIT_HINT },
    });
    expect(later).not.toHaveBeenCalled();
  });

  it("starts working again once the fail-fast window has passed", async () => {
    const { gate, state } = gateWith();
    await gate.guard(outcomes(limited(), limited()));
    state.time += FAIL_FAST_WINDOW_MS;

    const result = await gate.guard(outcomes(ok("recovered")));

    expect(result).toEqual(ok("recovered"));
  });

  it("holds back an item that starts while another item is backing off", async () => {
    const release = Promise.withResolvers<void>();
    const { gate, state } = gateWith(() => 0, release.promise);
    const first = gate.guard(outcomes(limited(), ok("a")));
    await vi.waitFor(() => expect(state.slept).toHaveLength(1));
    const laterTask = outcomes(ok("b"));

    const later = gate.guard(laterTask);
    await Promise.resolve();

    expect(laterTask).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([first, later]);
    expect(laterTask).toHaveBeenCalledOnce();
  });

  it("backs off longer when several items are limited at once", async () => {
    const { gate, state } = gateWith();

    await Promise.all([
      gate.guard(outcomes(limited(), ok("a"))),
      gate.guard(outcomes(limited(), ok("b"))),
    ]);

    expect(state.slept).toEqual([BASE_MS, DOUBLE_BACKOFF_MS]);
  });

  it("fails an item fast on its retry when another item started failing fast while it waited", async () => {
    const sleeps: { ms: number; wake: () => void }[] = [];
    let time = 0;
    const clock: Clock = {
      now: () => time,
      sleep: (ms) =>
        new Promise((resolve) =>
          sleeps.push({
            ms,
            wake: () => {
              time += ms;
              resolve();
            },
          }),
        ),
    };
    const gate = createRateLimitGate({
      clock,
      random: () => 0,
      isRateLimitFailure: isRateLimitCode,
    });
    const waiting = outcomes(limited(), ok("never runs"));
    const starter = outcomes(limited(), limited());
    const waited = gate.guard(waiting);
    const started = gate.guard(starter);
    await vi.waitFor(() => expect(sleeps).toHaveLength(2));
    expect(sleeps.map(({ ms }) => ms)).toEqual([BASE_MS, DOUBLE_BACKOFF_MS]);

    sleeps[1]?.wake();
    await started;
    sleeps[0]?.wake();

    expect(await waited).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED", hint: LIMIT_HINT },
    });
    expect(waiting).toHaveBeenCalledOnce();
  });

  it("reports CANCELLED when the caller aborts while waiting", async () => {
    const aborting: Clock = {
      now: () => 0,
      sleep: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    };
    const gate = createRateLimitGate({
      clock: aborting,
      random: () => 0,
      isRateLimitFailure: isRateLimitCode,
    });

    const result = await gate.guard(outcomes(limited(), ok("never")));

    expect(result).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("recognises a rate limit with the predicate it was given instead of the error code", async () => {
    const fake = fakeClock();
    const gate = createRateLimitGate({
      clock: fake.clock,
      random: () => 0,
      isRateLimitFailure: (error) => error.message === "slow down",
    });
    const task = outcomes(err("PROCESS_FAILED", "slow down"), ok("again"));

    const result = await gate.guard(task);

    expect(result).toEqual(ok("again"));
    expect(task).toHaveBeenCalledTimes(2);
    expect(fake.state.slept).toEqual([BASE_MS]);
  });
});
