import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeQuietly, writeFileAtomically } from "../src/infra/files.js";
import { withTempDir } from "./support/temp-dir.js";

describe("writeFileAtomically", () => {
  const temp = withTempDir("media-mcp-files-");

  it("writes the text and leaves only the target behind", async () => {
    const target = join(temp.path, "out.txt");

    await writeFileAtomically(target, "hello");

    expect(await readFile(target, "utf8")).toBe("hello");
    expect(await readdir(temp.path)).toEqual(["out.txt"]);
  });

  it("replaces an existing file", async () => {
    const target = join(temp.path, "out.txt");
    await writeFile(target, "old");

    await writeFileAtomically(target, "new");

    expect(await readFile(target, "utf8")).toBe("new");
  });

  it("rethrows the original error and removes its temporary file when the rename fails", async () => {
    const target = join(temp.path, "taken");
    await mkdir(target);
    await writeFile(join(target, "inside"), "x");

    await expect(writeFileAtomically(target, "text")).rejects.toMatchObject({
      syscall: "rename",
    });

    expect(await readdir(temp.path)).toEqual(["taken"]);
  });

  it("rethrows when the folder does not exist", async () => {
    await expect(
      writeFileAtomically(join(temp.path, "missing", "out.txt"), "x"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("removeQuietly", () => {
  const temp = withTempDir("media-mcp-remove-");

  it("removes a file and tolerates one that is already gone", async () => {
    const file = join(temp.path, "a.txt");
    await writeFile(file, "x");

    await removeQuietly(file);
    await removeQuietly(file);

    expect(await readdir(temp.path)).toEqual([]);
  });

  it("removes a directory only when asked to recurse, and never throws", async () => {
    const folder = join(temp.path, "folder");
    await mkdir(join(folder, "nested"), { recursive: true });

    await expect(removeQuietly(folder)).resolves.toBeUndefined();
    expect((await stat(folder)).isDirectory()).toBe(true);

    await removeQuietly(folder, { recursive: true });
    await expect(stat(folder)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
