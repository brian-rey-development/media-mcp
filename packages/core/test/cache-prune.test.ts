import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDiskCache, pruneExpired } from "../src/infra/cache.js";
import { fakeClock } from "./support/fake-clock.js";
import { withTempDir } from "./support/temp-dir.js";

const ENTRY_COUNT = 40;
const TTL_MS = 1_000;

const reads = vi.hoisted(() => ({ now: 0, peak: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const countingReadFile = async (
    path: Parameters<typeof actual.readFile>[0],
    encoding: "utf8",
  ): Promise<string> => {
    reads.now += 1;
    reads.peak = Math.max(reads.peak, reads.now);
    await new Promise((resolve) => setImmediate(resolve));
    try {
      return await actual.readFile(path, encoding);
    } finally {
      reads.now -= 1;
    }
  };
  return { ...actual, readFile: countingReadFile };
});

describe("pruneExpired with a large cache", () => {
  const temp = withTempDir("media-mcp-prune-bound-");

  it("reads one entry at a time so start up never opens the whole cache at once", async () => {
    const dir = join(temp.path, "cache");
    const { clock, state } = fakeClock();
    const cache = createDiskCache(dir, clock);
    for (let index = 0; index < ENTRY_COUNT; index += 1)
      await cache.set(`key-${index}`, "value", TTL_MS);
    reads.peak = 0;

    state.time = TTL_MS;
    await pruneExpired(dir, clock);

    expect(reads.peak).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});
