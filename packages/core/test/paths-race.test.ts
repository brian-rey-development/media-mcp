import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectoryVerifier } from "../src/infra/paths.js";
import { withTempDir } from "./support/temp-dir.js";

const swap = vi.hoisted(() => ({ target: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const swappingMkdir = async (
    path: Parameters<typeof actual.mkdir>[0],
    options: { recursive: true },
  ): Promise<string | undefined> => {
    const created = await actual.mkdir(path, options);
    if (swap.target !== "") {
      await actual.rm(path, { recursive: true });
      await actual.symlink(swap.target, path);
    }
    return created;
  };
  return { ...actual, mkdir: swappingMkdir };
});

describe("a directory verifier when the folder is swapped for a link after it was created", () => {
  const temp = withTempDir("media-mcp-race-");

  afterEach(() => {
    swap.target = "";
  });

  it("refuses the directory instead of handing back a path that now leads outside the root", async () => {
    const root = join(temp.path, "root");
    const outside = join(temp.path, "outside");
    await mkdir(root);
    await mkdir(outside);
    swap.target = outside;

    const result = await createDirectoryVerifier(root, "clips")();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_PATH_ESCAPE" },
    });
  });
});
