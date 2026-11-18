import type { Cache } from "../infra/cache.js";
import type { Clock } from "../infra/clock.js";

interface Remembered {
  expiresAt: number;
  value: unknown;
}

export const createMemoryCache = (clock: Clock): Cache => {
  const memory = new Map<string, Remembered>();
  return {
    async get(key, schema) {
      const hit = memory.get(key);
      if (!hit || hit.expiresAt <= clock.now()) return undefined;
      const parsed = schema.safeParse(hit.value);
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, value, ttlMs) {
      const now = clock.now();
      for (const [other, entry] of memory) {
        if (entry.expiresAt <= now) memory.delete(other);
      }
      memory.set(key, { expiresAt: now + ttlMs, value });
    },
  };
};
