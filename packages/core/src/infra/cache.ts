import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Clock, systemClock } from "./clock.js";
import {
  removeQuietly,
  TEMPORARY_SUFFIX,
  writeFileAtomically,
} from "./files.js";
import { MS_PER_HOUR } from "./units.js";

const ENTRY_SUFFIX = ".json";
// A write still in flight is never this old, so an older temporary file was left by a crash.
const ORPHAN_TEMP_AGE_MS = MS_PER_HOUR;

const EntrySchema = z.object({ expiresAt: z.number(), value: z.unknown() });

type Entry = z.infer<typeof EntrySchema>;

export interface Cache {
  get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

const fileFor = (dir: string, key: string): string =>
  join(dir, `${createHash("sha256").update(key).digest("hex")}${ENTRY_SUFFIX}`);

const readEntry = async (file: string): Promise<Entry | undefined> => {
  try {
    const parsed = EntrySchema.safeParse(
      JSON.parse(await readFile(file, "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const writeQuietly = async (
  dir: string,
  file: string,
  entry: Entry,
): Promise<void> => {
  try {
    await mkdir(dir, { recursive: true });
    await writeFileAtomically(file, JSON.stringify(entry));
  } catch {
    return;
  }
};

export const createDiskCache = (dir: string, clock: Clock): Cache => ({
  async get(key, schema) {
    const file = fileFor(dir, key);
    const entry = await readEntry(file);
    if (!entry) return undefined;
    if (entry.expiresAt <= clock.now()) {
      await removeQuietly(file);
      return undefined;
    }
    const parsed = schema.safeParse(entry.value);
    return parsed.success ? parsed.data : undefined;
  },
  async set(key, value, ttlMs) {
    const entry = { expiresAt: clock.now() + ttlMs, value };
    await writeQuietly(dir, fileFor(dir, key), entry);
  },
});

const isStaleEntry = async (file: string, now: number): Promise<boolean> => {
  const entry = await readEntry(file);
  return entry === undefined || entry.expiresAt <= now;
};

const isOrphanedTemp = async (file: string, now: number): Promise<boolean> => {
  try {
    return now - (await stat(file)).mtimeMs >= ORPHAN_TEMP_AGE_MS;
  } catch {
    return false;
  }
};

const isPrunable = (name: string, file: string, now: number) => {
  if (name.endsWith(ENTRY_SUFFIX)) return isStaleEntry(file, now);
  if (name.endsWith(TEMPORARY_SUFFIX)) return isOrphanedTemp(file, now);
  return false;
};

export const pruneExpired = async (
  dir: string,
  clock: Clock = systemClock,
): Promise<void> => {
  const names = await readdir(dir).catch((): string[] => []);
  const now = clock.now();
  for (const name of names) {
    const file = join(dir, name);
    if (await isPrunable(name, file, now)) await removeQuietly(file);
  }
};
