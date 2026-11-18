import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

export interface TempDir {
  readonly path: string;
}

export const withTempDir = (prefix = "media-mcp-test-"): TempDir => {
  const holder = { path: "" };
  beforeEach(async () => {
    holder.path = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  });
  afterEach(() => rm(holder.path, { recursive: true, force: true }));
  return holder;
};
