import type { MediaError } from "../domain/errors.js";
import { err, fail, ok, type Result } from "../domain/result.js";
import type { Clock } from "./clock.js";

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const JITTER_RATIO = 0.25;
const FAIL_FAST_WINDOW_MS = 60_000;

export interface RateLimitGate {
  guard<T>(
    task: () => Promise<Result<T>>,
    signal?: AbortSignal,
  ): Promise<Result<T>>;
}

interface GateOptions {
  clock: Clock;
  random: () => number;
  isRateLimitFailure: (error: MediaError) => boolean;
}

interface Gate extends GateOptions {
  pausedUntil: number;
  failFastUntil: number;
  strikes: number;
  lastLimit: MediaError | undefined;
}

type Attempt<T> =
  | { kind: "blocked"; error: MediaError }
  | { kind: "settled"; result: Result<T> };

type Limited = { ok: false; error: MediaError };

const isRateLimited = <T>(gate: Gate, result: Result<T>): result is Limited =>
  !result.ok && gate.isRateLimitFailure(result.error);

const waitForTurn = async (
  gate: Gate,
  signal?: AbortSignal,
): Promise<Result<void>> => {
  const remaining = gate.pausedUntil - gate.clock.now();
  if (remaining <= 0) return ok(undefined);
  try {
    await gate.clock.sleep(remaining, signal);
  } catch {
    return err("CANCELLED", "Cancelled while waiting out a rate limit");
  }
  return waitForTurn(gate, signal);
};

const pause = (gate: Gate, error: MediaError): void => {
  gate.strikes += 1;
  gate.lastLimit = error;
  const backoff = Math.min(
    BACKOFF_BASE_MS * 2 ** (gate.strikes - 1),
    BACKOFF_MAX_MS,
  );
  const delay = backoff * (1 + JITTER_RATIO * gate.random());
  gate.pausedUntil = Math.max(gate.pausedUntil, gate.clock.now() + delay);
};

const startFailingFast = (gate: Gate): void => {
  if (gate.clock.now() < gate.failFastUntil) return;
  gate.failFastUntil = gate.clock.now() + FAIL_FAST_WINDOW_MS;
};

const attempt = async <T>(
  gate: Gate,
  task: () => Promise<Result<T>>,
  signal?: AbortSignal,
): Promise<Attempt<T>> => {
  const turn = await waitForTurn(gate, signal);
  if (!turn.ok) return { kind: "settled", result: turn };
  const blocking = gate.clock.now() < gate.failFastUntil && gate.lastLimit;
  if (blocking) return { kind: "blocked", error: blocking };
  return { kind: "settled", result: await task() };
};

const guarded = async <T>(
  gate: Gate,
  task: () => Promise<Result<T>>,
  signal?: AbortSignal,
): Promise<Result<T>> => {
  const first = await attempt(gate, task, signal);
  if (first.kind === "blocked") return fail(first.error);
  if (!isRateLimited(gate, first.result)) {
    gate.strikes = 0;
    return first.result;
  }
  pause(gate, first.result.error);
  const second = await attempt(gate, task, signal);
  if (second.kind === "blocked") return fail(second.error);
  if (isRateLimited(gate, second.result)) startFailingFast(gate);
  else gate.strikes = 0;
  return second.result;
};

export const createRateLimitGate = (options: GateOptions): RateLimitGate => {
  const gate: Gate = {
    ...options,
    pausedUntil: 0,
    failFastUntil: 0,
    strikes: 0,
    lastLimit: undefined,
  };
  return { guard: (task, signal) => guarded(gate, task, signal) };
};
