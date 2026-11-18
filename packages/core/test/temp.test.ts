import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../src/domain/result.js";
import { withTempDirectory } from "../src/infra/temp.js";
import { withTempDir } from "./support/temp-dir.js";

describe("withTempDirectory", () => {
  const temp = withTempDir("media-mcp-temp-");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands the work a fresh directory and removes it afterwards", async () => {
    let seen = "";

    const result = await withTempDirectory(
      "media-mcp-use-",
      async (directory) => {
        seen = directory;
        return ok((await stat(directory)).isDirectory());
      },
    );

    expect(result).toEqual(ok(true));
    await expect(stat(seen)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the directory when the work fails", async () => {
    let seen = "";

    const result = await withTempDirectory(
      "media-mcp-fail-",
      async (directory) => {
        seen = directory;
        return err("PARSE_FAILED", "bad");
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PARSE_FAILED" },
    });
    await expect(stat(seen)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports IO_FAILED without the absolute temp path when the directory cannot be created", async () => {
    vi.stubEnv("TMPDIR", join(temp.path, "missing", "deeper"));

    const result = await withTempDirectory("media-mcp-none-", async () =>
      ok("never"),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "IO_FAILED" } });
    expect(JSON.stringify(result)).not.toContain(temp.path);
  });
});
