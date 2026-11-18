import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  link,
  mkdir,
  open,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { ok } from "../src/domain/result.js";
import { UNTRUSTED_NOTICE } from "../src/domain/untrusted.js";
import {
  MAX_TRANSCRIPT_PAGE_CHARS,
  MAX_TRANSCRIPT_PAGE_LINES,
} from "../src/services/transcript-pages.js";
import type { TranscriptPage } from "../src/services/types.js";
import { transcriptOf, videoId, watchUrl } from "./support/fake-provider.js";
import { EN, servicesFixture } from "./support/services-fixture.js";
import { unwrap, unwrapError } from "./support/unwrap.js";

const FILE_NAME = "youtube-abc123.en.plain.txt";
const MEGABYTE = 1024 * 1024;
const SAVED_TRANSCRIPT_CAP = 16 * MEGABYTE;
const FIFO_PATIENCE_MS = 1_000;
const PENDING = "pending";
const LINE_COUNT = 25;
const PAGE = 10;
const LINE_WIDTH = 100;
const CHUNK_BYTES = 64 * 1024;

const numbered = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`);

describe("reading a saved transcript page by page", () => {
  const { setup, temp } = servicesFixture();
  let fixture: ReturnType<typeof setup>;
  let folder: string;

  beforeEach(async () => {
    fixture = setup();
    folder = join(fixture.root, "transcripts");
    await mkdir(folder, { recursive: true });
  });

  const saved = async (lines: readonly string[], name = FILE_NAME) => {
    await writeFile(join(folder, name), lines.join("\n"));
    return join(folder, name);
  };
  const read = (path: string, startLine = 1, maxLines = PAGE) =>
    fixture.services.transcriptFiles.read({ path, startLine, maxLines });

  it("returns the file a transcript was saved to, notice line first", async () => {
    const big = setup({
      overrides: {
        getTranscript: async (ref) =>
          ok(transcriptOf(ref, "word ".repeat(LINE_WIDTH * 3))),
      },
      config: { transcriptCharBudget: 10 },
    });
    const { entries } = await big.services.transcripts.fetch({
      urls: [watchUrl(videoId(1))],
      ...EN,
    });
    const entry = entries[0];
    const filePath =
      entry?.ok && entry.value.mode === "file" ? entry.value.filePath : "";

    const page = unwrap(
      await big.services.transcriptFiles.read({
        path: filePath,
        startLine: 1,
        maxLines: 3,
      }),
    );

    expect(page.text.split("\n")).toEqual([
      UNTRUSTED_NOTICE,
      "",
      expect.stringMatching(/^word word/),
    ]);
    expect(page).toMatchObject({
      path: filePath,
      startLine: 1,
      lineCount: 3,
      nextStartLine: 4,
    });
  });

  it("reads a saved transcript exactly at the size cap", async () => {
    const path = join(folder, FILE_NAME);
    await writeFile(path, "");
    await truncate(path, SAVED_TRANSCRIPT_CAP);

    expect(unwrap(await read(path))).toMatchObject({ startLine: 1 });
  });

  it("finds a file by its bare name inside the transcripts folder", async () => {
    await saved(numbered(LINE_COUNT));

    expect(unwrap(await read(FILE_NAME))).toMatchObject({
      totalLines: LINE_COUNT,
    });
  });

  it.each([
    ["the first page", 1, { lineCount: PAGE, nextStartLine: PAGE + 1 }],
    ["a page that ends on the last line", 16, { lineCount: PAGE }],
    ["the short last page", 21, { lineCount: 5 }],
    ["a start past the end", 100, { lineCount: 0, text: "" }],
  ])("pages through the lines, %s", async (_label, startLine, expected) => {
    const page = unwrap(
      await read(await saved(numbered(LINE_COUNT)), startLine),
    );

    expect(page).toMatchObject({
      startLine,
      totalLines: LINE_COUNT,
      ...expected,
    });
    if (!("nextStartLine" in expected))
      expect(page).not.toHaveProperty("nextStartLine");
  });

  it("returns exactly the requested lines", async () => {
    const page = unwrap(await read(await saved(numbered(LINE_COUNT)), 11, 3));

    expect(page.text).toBe("line 11\nline 12\nline 13");
  });

  it("caps the number of lines per call", async () => {
    const lines = numbered(MAX_TRANSCRIPT_PAGE_LINES + 50);

    const page = unwrap(
      await read(await saved(lines), 1, MAX_TRANSCRIPT_PAGE_LINES * 5),
    );

    expect(page.lineCount).toBe(MAX_TRANSCRIPT_PAGE_LINES);
    expect(page.nextStartLine).toBe(MAX_TRANSCRIPT_PAGE_LINES + 1);
  });

  it("stops early at the character cap and says where to continue", async () => {
    const lines = Array.from({ length: 300 }, () => "x".repeat(LINE_WIDTH));
    const fitting = Math.floor(
      (MAX_TRANSCRIPT_PAGE_CHARS + 1) / (LINE_WIDTH + 1),
    );

    const page = unwrap(
      await read(await saved(lines), 1, MAX_TRANSCRIPT_PAGE_LINES),
    );

    expect(page.text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_PAGE_CHARS);
    expect(page).toMatchObject({
      lineCount: fitting,
      nextStartLine: fitting + 1,
    });
  });

  it("cuts a line longer than the cap and still moves on", async () => {
    const huge = "y".repeat(MAX_TRANSCRIPT_PAGE_CHARS * 50);

    const page = unwrap(await read(await saved([huge, "after"]), 1, 1));

    expect(page.text).toHaveLength(MAX_TRANSCRIPT_PAGE_CHARS);
    expect(page).toMatchObject({ totalLines: 2, nextStartLine: 2 });
  });

  it("never splits a multibyte character, even across read chunks", async () => {
    const line = "ñandú 😀 ".repeat(40);
    const count = Math.ceil((CHUNK_BYTES * 3) / Buffer.byteLength(line));
    const lines = Array.from(
      { length: count },
      (_, index) => `${index} ${line}`,
    );
    const path = await saved(lines);
    const pages: string[] = [];

    let next: number | undefined = 1;
    while (next !== undefined) {
      const page: TranscriptPage = unwrap(
        await read(path, next, MAX_TRANSCRIPT_PAGE_LINES),
      );
      pages.push(page.text);
      next = page.nextStartLine;
    }

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("\n")).toBe(lines.join("\n"));
  });

  describe("refuses", () => {
    it.each([
      ["a path that climbs out with ..", () => "../../outside.txt"],
      [
        "an absolute path outside the folder",
        () => join(temp.path, "outside.txt"),
      ],
      [
        "a file in the output root next to the folder",
        () => join(fixture.root, "loose.txt"),
      ],
    ])("%s as OUTPUT_PATH_ESCAPE", async (_label, path) => {
      await writeFile(join(temp.path, "outside.txt"), "secret");
      await writeFile(join(fixture.root, "loose.txt"), "secret");

      expect(unwrapError(await read(path()))).toMatchObject({
        code: "OUTPUT_PATH_ESCAPE",
        hint: expect.stringContaining("get_transcripts"),
      });
    });

    it("a link inside the folder that points outside", async () => {
      await writeFile(join(temp.path, "outside.txt"), "secret");
      await symlink(
        join(temp.path, "outside.txt"),
        join(folder, "youtube-link.en.plain.txt"),
      );

      expect(
        unwrapError(await read(join(folder, "youtube-link.en.plain.txt"))),
      ).toMatchObject({
        code: "OUTPUT_PATH_ESCAPE",
      });
    });

    it("a link inside the folder that points nowhere", async () => {
      await symlink(
        join(temp.path, "gone.txt"),
        join(folder, "youtube-dangling.en.plain.txt"),
      );

      expect(
        unwrapError(await read(join(folder, "youtube-dangling.en.plain.txt"))),
      ).toMatchObject({
        code: "OUTPUT_PATH_ESCAPE",
      });
    });

    it.each([
      ["a missing file", () => join(folder, "youtube-missing.en.plain.txt")],
      ["a folder", () => folder],
    ])("%s as FILE_NOT_FOUND", async (_label, path) => {
      const error = unwrapError(await read(path()));

      expect(error).toMatchObject({
        code: "FILE_NOT_FOUND",
        hint: expect.stringContaining("get_transcripts"),
      });
      expect(JSON.stringify(error)).not.toContain(temp.path);
    });

    it("creates no folder when the transcripts folder does not exist yet", async () => {
      await rm(folder, { recursive: true });

      const error = unwrapError(await read(join(folder, FILE_NAME)));

      expect(error).toMatchObject({ code: "FILE_NOT_FOUND" });
      await expect(stat(folder)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("a hard link to a file outside the transcripts folder as OUTPUT_PATH_ESCAPE", async () => {
      const outside = join(temp.path, "outside.txt");
      await writeFile(outside, "secret");
      const inside = join(folder, FILE_NAME);
      await link(outside, inside);

      expect(unwrapError(await read(inside))).toMatchObject({
        code: "OUTPUT_PATH_ESCAPE",
        hint: expect.stringContaining("get_transcripts"),
      });
    });

    it.each([
      ["a video file", "movie.mp4", 5 * MEGABYTE],
      ["a temporary file", `${FILE_NAME}.tmp`, 10],
      ["a name that is not a saved transcript", "notes.txt", 10],
      ["a name with an unknown format", "youtube-abc.en.raw.txt", 10],
      [
        "a saved transcript over the size cap",
        FILE_NAME,
        SAVED_TRANSCRIPT_CAP + 1,
      ],
    ])(
      "%s as FILE_NOT_FOUND saying only get_transcripts files can be read",
      async (_label, name, size) => {
        const path = join(folder, name);
        await writeFile(path, "");
        await truncate(path, size);

        expect(unwrapError(await read(path))).toMatchObject({
          code: "FILE_NOT_FOUND",
          hint: expect.stringMatching(/only .*get_transcripts/i),
        });
      },
    );

    it("a call whose signal is already aborted", async () => {
      const path = await saved(numbered(LINE_COUNT));

      const result = await fixture.services.transcriptFiles.read(
        { path, startLine: 1, maxLines: PAGE },
        AbortSignal.abort(),
      );

      expect(unwrapError(result)).toMatchObject({ code: "CANCELLED" });
    });
  });

  describe.skipIf(process.platform === "win32")("with a named pipe", () => {
    it("answers promptly instead of waiting for a writer that never comes", async () => {
      const pipe = join(folder, FILE_NAME);
      await promisify(execFile)("mkfifo", [pipe]);

      const outcome = await Promise.race([
        read(pipe),
        new Promise<typeof PENDING>((resolve) =>
          setTimeout(() => resolve(PENDING), FIFO_PATIENCE_MS),
        ),
      ]);

      // Opening a pipe for writing releases an open that still blocks, so a failing run leaks no thread.
      await (await open(pipe, constants.O_RDWR)).close();
      if (outcome === PENDING) throw new Error("the read is still waiting");
      expect(unwrapError(outcome)).toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
