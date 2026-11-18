import {
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { VerifiedDirectory } from "../src/domain/media.js";
import type { Result } from "../src/domain/result.js";
import {
  createDirectoryVerifier,
  locateWithinRoot,
  resolveWithinRoot,
} from "../src/infra/paths.js";
import { withTempDir } from "./support/temp-dir.js";
import { unwrap } from "./support/unwrap.js";
import { verified } from "./support/verified-directory.js";

const OUTSIDE = /outside the output root/;
const UNRESOLVABLE = /could not be resolved safely/;

describe("resolveWithinRoot", () => {
  const temp = withTempDir("media-mcp-paths-");
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = join(temp.path, "root");
    outside = join(temp.path, "outside");
    await mkdir(root);
    await mkdir(outside);
  });

  const expectEscape = (result: Result<string>, message: RegExp) => {
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "OUTPUT_PATH_ESCAPE",
        message: expect.stringMatching(message),
      },
    });
    expect(JSON.stringify(result)).not.toContain(temp.path);
  };

  it("returns the root itself when nothing is requested", async () => {
    expect(await resolveWithinRoot(root, undefined)).toEqual({
      ok: true,
      value: root,
    });
  });

  it("returns a subdirectory without creating anything, not even a missing root", async () => {
    const freshRoot = join(temp.path, "fresh");

    expect(await resolveWithinRoot(root, "notes")).toEqual({
      ok: true,
      value: join(root, "notes"),
    });
    expect(await resolveWithinRoot(freshRoot, "notes")).toEqual({
      ok: true,
      value: join(freshRoot, "notes"),
    });
    expect(await readdir(root)).toEqual([]);
    await expect(stat(freshRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a relative path that climbs out of the root", async () => {
    expectEscape(await resolveWithinRoot(root, "../../etc"), OUTSIDE);
  });

  it("rejects an absolute path outside the root", async () => {
    expectEscape(await resolveWithinRoot(root, outside), OUTSIDE);
  });

  it("rejects a sibling directory that only shares the root as a name prefix", async () => {
    const sibling = `${root}-evil`;
    await mkdir(sibling);

    expectEscape(await resolveWithinRoot(root, sibling), OUTSIDE);
  });

  it("rejects a symlink inside the root that points outside it", async () => {
    await symlink(outside, join(root, "link"));

    expectEscape(await resolveWithinRoot(root, "link"), OUTSIDE);
    expectEscape(await resolveWithinRoot(root, "link/deeper"), OUTSIDE);
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects a dangling symlink inside the root without creating its target", async () => {
    await symlink(join(outside, "not-yet"), join(root, "dangling"));

    expectEscape(await resolveWithinRoot(root, "dangling"), UNRESOLVABLE);
    expect(await readdir(outside)).toEqual([]);
  });

  it("accepts an absolute path inside the root", async () => {
    const inside = join(root, "abs");

    expect(await resolveWithinRoot(root, inside)).toEqual({
      ok: true,
      value: inside,
    });
  });

  it("accepts a symlink inside the root that points elsewhere inside it", async () => {
    const real = join(root, "real");
    await mkdir(real);
    await symlink(real, join(root, "alias"));

    expect(await resolveWithinRoot(root, "alias/sub")).toEqual({
      ok: true,
      value: join(real, "sub"),
    });
  });

  it("returns the real path when the root is reached through a symlink", async () => {
    const alias = join(temp.path, "root-alias");
    await symlink(root, alias);

    expect(await resolveWithinRoot(alias, "notes")).toEqual({
      ok: true,
      value: join(root, "notes"),
    });
  });

  it("reports a neutral message when the path runs through a file", async () => {
    await writeFile(join(root, "taken"), "a file");

    expectEscape(await resolveWithinRoot(root, "taken/child"), UNRESOLVABLE);
  });

  it.each(["%(title)s", "%(a|..)s/%(a|..)s/x", "$HOME", "a%%b"])(
    "treats %j as a literal directory name and never expands it",
    async (name) => {
      expect(await resolveWithinRoot(root, name)).toEqual({
        ok: true,
        value: join(root, name),
      });
    },
  );

  it("accepts a path under a root that ends with the separator", async () => {
    expect(await resolveWithinRoot("/", tmpdir())).toEqual({
      ok: true,
      value: await realpath(tmpdir()),
    });
  });
});

describe("verifying a directory", () => {
  const temp = withTempDir("media-mcp-verify-");

  it("creates a nested directory inside the root and returns its real path", async () => {
    const verified = await createDirectoryVerifier(temp.path, join("a", "b"))();

    expect(unwrap(verified)).toBe(join(temp.path, "a", "b"));
    expect((await stat(join(temp.path, "a", "b"))).isDirectory()).toBe(true);
  });

  it("creates the root itself when nothing is requested", async () => {
    const root = join(temp.path, "fresh-root");

    expect(unwrap(await createDirectoryVerifier(root, undefined)())).toBe(root);
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it("accepts a directory that already exists", async () => {
    expect(unwrap(await createDirectoryVerifier(temp.path, undefined)())).toBe(
      temp.path,
    );
  });

  it("refuses a path outside the root without creating anything", async () => {
    const outside = join(temp.path, "outside");
    const root = join(temp.path, "root");
    await mkdir(root);

    const result = await createDirectoryVerifier(root, "../outside/made")();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_PATH_ESCAPE" },
    });
    await expect(stat(outside)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports IO_FAILED without the absolute path when the target is an existing file", async () => {
    await writeFile(join(temp.path, "taken"), "a file");

    const result = await createDirectoryVerifier(temp.path, "taken")();

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IO_FAILED",
        hint: "Choose a path that is a writable directory",
      },
    });
    expect(JSON.stringify(result)).not.toContain(temp.path);
  });
});

describe("createDirectoryVerifier", () => {
  const temp = withTempDir("media-mcp-verifier-");

  it("creates nothing until asked, then verifies the folder once and reuses the answer", async () => {
    const lazy = join(temp.path, "lazy");
    const verify = createDirectoryVerifier(temp.path, "lazy");
    await expect(stat(lazy)).rejects.toMatchObject({ code: "ENOENT" });

    const first = await verify();
    await rm(lazy, { recursive: true });
    const second = await verify();

    expect(unwrap(first)).toBe(lazy);
    expect(second).toBe(first);
    await expect(stat(lazy)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("verifies the root itself when no folder is requested", async () => {
    expect(unwrap(await createDirectoryVerifier(temp.path)())).toBe(temp.path);
  });

  it("repeats a refusal instead of retrying it", async () => {
    const verify = createDirectoryVerifier(temp.path, "../outside");

    const first = await verify();

    expect(first).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_PATH_ESCAPE" },
    });
    expect(await verify()).toBe(first);
  });
});

describe("locateWithinRoot", () => {
  const temp = withTempDir("media-mcp-locate-");
  let root: VerifiedDirectory;
  let outside: string;

  beforeEach(async () => {
    outside = join(temp.path, "outside");
    await mkdir(outside);
    root = await verified(join(temp.path, "root"));
    await writeFile(join(root, "clip.mp4"), "x");
    await writeFile(join(outside, "stray.mp4"), "x");
  });

  it("returns the real path of a file named relative to the root", async () => {
    expect(await locateWithinRoot(root, "clip.mp4")).toEqual({
      ok: true,
      value: join(root, "clip.mp4"),
    });
  });

  it("accepts an absolute path inside the root", async () => {
    const inside = join(root, "clip.mp4");

    expect(await locateWithinRoot(root, inside)).toEqual({
      ok: true,
      value: inside,
    });
  });

  it("answers undefined for a file that does not exist", async () => {
    expect(await locateWithinRoot(root, "missing.mp4")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each([
    ["an absolute path outside the root", () => join(outside, "stray.mp4")],
    ["a relative path that climbs out", () => "../outside/stray.mp4"],
  ])(
    "refuses %s with the standard message and a hint",
    async (_label, path) => {
      const result = await locateWithinRoot(root, path());

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "OUTPUT_PATH_ESCAPE",
          message: expect.stringMatching(OUTSIDE),
          hint: expect.stringContaining("Use a path inside"),
        },
      });
      expect(JSON.stringify(result)).not.toContain(temp.path);
    },
  );

  it("refuses a file reached through a symlink that leaves the root", async () => {
    await symlink(outside, join(root, "link"));

    expect(await locateWithinRoot(root, "link/stray.mp4")).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_PATH_ESCAPE" },
    });
  });

  it("reports IO_FAILED, not a missing file, when a path component is a file", async () => {
    expect(await locateWithinRoot(root, "clip.mp4/child")).toMatchObject({
      ok: false,
      error: { code: "IO_FAILED" },
    });
  });
});
