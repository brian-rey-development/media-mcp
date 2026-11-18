import { setTimeout as delay } from "node:timers/promises";

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => delay(ms, undefined, signal ? { signal } : {}),
};
