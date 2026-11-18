import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDiskCache, pruneExpired } from "../src/infra/cache.js";
import { systemClock } from "../src/infra/clock.js";
import { MS_PER_HOUR, MS_PER_MINUTE } from "../src/infra/units.js";
import { fakeClock } from "./support/fake-clock.js";
import { withTempDir } from "./support/temp-dir.js";

const TTL_MS = 1_000;
const StringSchema = z.string();
const HASHED_FILE_NAME = /^[0-9a-f]{64}\.json$/;

const onlyCacheFile = async (dir: string): Promise<string> => {
  const [fileName] = await readdir(dir);
  if (fileName === undefined) throw new Error("no cache file was written");
  return fileName;
};

describe("createDiskCache", () => {
  const temp = withTempDir("media-mcp-cache-");
  let base: string;
  let dir: string;

  beforeEach(() => {
    base = temp.path;
    dir = join(base, "cache");
  });

  it("round-trips a stored value", async () => {
    const cache = createDiskCache(dir, systemClock);

    await cache.set("key", "value", TTL_MS);

    expect(await cache.get("key", StringSchema)).toBe("value");
  });

  it("returns undefined for a key that was never stored", async () => {
    expect(
      await createDiskCache(dir, systemClock).get("missing", StringSchema),
    ).toBeUndefined();
  });

  it("returns undefined once the entry is past its time to live", async () => {
    const { clock, state } = fakeClock();
    const cache = createDiskCache(dir, clock);
    await cache.set("key", "value", TTL_MS);

    state.time += TTL_MS - 1;
    expect(await cache.get("key", StringSchema)).toBe("value");

    state.time += 1;
    expect(await cache.get("key", StringSchema)).toBeUndefined();
  });

  it("returns undefined when the stored value fails the schema", async () => {
    const cache = createDiskCache(dir, systemClock);
    await cache.set("key", 42, TTL_MS);

    expect(await cache.get("key", StringSchema)).toBeUndefined();
  });

  it("returns undefined when the file on disk is corrupt", async () => {
    const cache = createDiskCache(dir, systemClock);
    await cache.set("key", "value", TTL_MS);
    await writeFile(join(dir, await onlyCacheFile(dir)), "{not json");

    expect(await cache.get("key", StringSchema)).toBeUndefined();
  });

  it("deletes the file of an expired entry when it is read", async () => {
    const { clock, state } = fakeClock();
    const cache = createDiskCache(dir, clock);
    await cache.set("key", "value", TTL_MS);
    state.time += TTL_MS;

    await cache.get("key", StringSchema);

    expect(await readdir(dir)).toEqual([]);
  });

  it("removes its temporary file when the final rename fails", async () => {
    const probeDir = join(base, "probe");
    await createDiskCache(probeDir, systemClock).set("key", "value", TTL_MS);
    const entryName = await onlyCacheFile(probeDir);
    await mkdir(join(dir, entryName), { recursive: true });
    const cache = createDiskCache(dir, systemClock);

    await expect(cache.set("key", "value", TTL_MS)).resolves.toBeUndefined();

    expect(await readdir(dir)).toEqual([entryName]);
  });

  it("never rejects on set when the directory cannot be written", async () => {
    const blocker = join(base, "blocker");
    await writeFile(blocker, "a file, not a directory");
    const cache = createDiskCache(join(blocker, "cache"), systemClock);

    await expect(cache.set("key", "value", TTL_MS)).resolves.toBeUndefined();
    expect(await cache.get("key", StringSchema)).toBeUndefined();
  });

  it.each(["../escape", "a/b/c", "../../etc/passwd"])(
    "keeps the entry for key %j inside the cache directory",
    async (key) => {
      const cache = createDiskCache(dir, systemClock);

      await cache.set(key, "value", TTL_MS);

      expect(await readdir(base)).toEqual(["cache"]);
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(HASHED_FILE_NAME);
      expect(await cache.get(key, StringSchema)).toBe("value");
    },
  );
});

describe("pruneExpired", () => {
  const temp = withTempDir("media-mcp-prune-");
  let time: ReturnType<typeof fakeClock>;

  beforeEach(() => {
    time = fakeClock();
  });

  it("removes expired and corrupt entries and keeps live ones", async () => {
    const dir = join(temp.path, "cache");
    const cache = createDiskCache(dir, time.clock);
    await cache.set("expired", "a", TTL_MS);
    await cache.set("live", "b", TTL_MS * 10);
    await writeFile(join(dir, `${"0".repeat(64)}.json`), "{not json");
    time.state.time += TTL_MS;

    await pruneExpired(dir, time.clock);

    expect(await readdir(dir)).toHaveLength(1);
    expect(await cache.get("live", StringSchema)).toBe("b");
  });

  it("leaves files that are not cache entries alone", async () => {
    await writeFile(join(temp.path, "notes.txt"), "keep me");

    await pruneExpired(temp.path, time.clock);

    expect(await readdir(temp.path)).toEqual(["notes.txt"]);
  });

  it("removes a temporary file left behind for an hour and keeps a recent one", async () => {
    const now = Date.now();
    const orphan = join(temp.path, `${"a".repeat(64)}.json.orphan.tmp`);
    const recent = join(temp.path, `${"b".repeat(64)}.json.recent.tmp`);
    await writeFile(orphan, "half written");
    await writeFile(recent, "being written");
    const secondsAgo = (ms: number) => (now - ms) / 1_000;
    await utimes(
      orphan,
      secondsAgo(2 * MS_PER_HOUR),
      secondsAgo(2 * MS_PER_HOUR),
    );
    await utimes(recent, secondsAgo(MS_PER_MINUTE), secondsAgo(MS_PER_MINUTE));

    await pruneExpired(temp.path, { ...systemClock, now: () => now });

    expect(await readdir(temp.path)).toEqual([
      `${"b".repeat(64)}.json.recent.tmp`,
    ]);
  });

  it("resolves quietly when the directory does not exist", async () => {
    await expect(
      pruneExpired(join(temp.path, "missing"), time.clock),
    ).resolves.toBeUndefined();
  });
});
