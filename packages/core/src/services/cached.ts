import type { z } from "zod";
import { ok, type Result } from "../domain/result.js";
import type { Cache } from "../infra/cache.js";
import { versionedKey } from "./cache-version.js";
import { createSingleFlight } from "./single-flight.js";

export type CachedLoader<T> = (
  key: string,
  load: () => Promise<Result<T>>,
  signal?: AbortSignal,
) => Promise<Result<T>>;

export const createCachedLoader = <T>(
  cache: Cache,
  schema: z.ZodType<T>,
  ttlMs: (value: T) => number,
): CachedLoader<T> => {
  const flights = createSingleFlight<T>();
  const loadThroughCache = async (
    key: string,
    load: () => Promise<Result<T>>,
  ): Promise<Result<T>> => {
    const stored = versionedKey(key);
    const hit = await cache.get(stored, schema);
    if (hit !== undefined) return ok(hit);
    const loaded = await load();
    if (loaded.ok) await cache.set(stored, loaded.value, ttlMs(loaded.value));
    return loaded;
  };
  return (key, load, signal) =>
    flights.run(key, () => loadThroughCache(key, load), signal);
};
