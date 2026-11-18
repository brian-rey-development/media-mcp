import {
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { err, ok } from "../src/domain/result.js";
import { UNTRUSTED_NOTICE } from "../src/domain/untrusted.js";
import type { Provider } from "../src/providers/provider.js";
import {
  FILE_ENTRY_OVERHEAD_CHARS,
  PREVIEW_CHARS,
} from "../src/services/delivery.js";
import { TEST_BUDGET } from "./support/config.js";
import { transcriptOf, videoId, watchUrl } from "./support/fake-provider.js";
import { EN, servicesFixture } from "./support/services-fixture.js";

const A = videoId(1);
const B = videoId(2);
const C = videoId(3);
const TINY_BUDGET = { transcriptCharBudget: 10 };
const LINE_LIMIT = 100;
const MAX_ITEMS = 50;
const MAX_FAILURE_TEXT_CHARS = 500;
const ROOM_FOR_SMALL_ITEMS = 100;
const BUDGET_AFTER_ONE_FILE =
  PREVIEW_CHARS + FILE_ENTRY_OVERHEAD_CHARS + ROOM_FOR_SMALL_ITEMS;

const sentence = (words: number): string =>
  Array.from({ length: words }, (_, index) => `word${index}`).join(" ");

const returning = (
  text: string | ((id: string) => string),
): Partial<Provider> => ({
  getTranscript: async (ref) =>
    ok(transcriptOf(ref, typeof text === "string" ? text : text(ref.id))),
});

describe("transcript delivery under the character budget", () => {
  const { setup, temp } = servicesFixture();
  const fetchOne = async (
    fixture: ReturnType<typeof setup>,
    request: object = {},
  ) => {
    const { entries } = await fixture.services.transcripts.fetch({
      urls: [watchUrl(A)],
      ...EN,
      ...request,
    });
    return entries[0];
  };
  const bodyOf = (written: string): string =>
    written.slice(`${UNTRUSTED_NOTICE}\n\n`.length);
  const fileOf = (fixture: ReturnType<typeof setup>, name: string) =>
    readFile(join(fixture.root, "transcripts", name), "utf8");

  it("delivers the earliest items inline and the rest as files with a preview", async () => {
    const text = (id: string) => `${id} ${sentence(60)}`;
    const fixture = setup({ overrides: returning(text) });

    const outcome = await fixture.services.transcripts.fetch({
      urls: [watchUrl(A), watchUrl(B), watchUrl(C)],
      ...EN,
    });

    const [first, second, third] = outcome.entries;
    expect(first).toMatchObject({
      ok: true,
      value: { mode: "inline", text: text(A) },
    });
    expect(second).toMatchObject({ ok: true, value: { mode: "inline" } });
    expect(third).toMatchObject({
      ok: true,
      value: {
        mode: "file",
        filePath: join(fixture.root, "transcripts", `fake-${C}.en.plain.txt`),
      },
    });
  });

  it("keeps small items inline after a huge one went to a file", async () => {
    const fixture = setup({
      overrides: returning((id) =>
        id === A ? "z".repeat(TEST_BUDGET * 5) : "short",
      ),
      config: { transcriptCharBudget: BUDGET_AFTER_ONE_FILE },
    });

    const outcome = await fixture.services.transcripts.fetch({
      urls: [watchUrl(A), watchUrl(B), watchUrl(C)],
      ...EN,
    });

    expect(outcome.entries).toMatchObject([
      { value: { mode: "file" } },
      { value: { mode: "inline" } },
      { value: { mode: "inline" } },
    ]);
  });

  it("writes the whole text as lines of about 100 characters after the notice", async () => {
    const text = sentence(400);
    const fixture = setup({ overrides: returning(text), config: TINY_BUDGET });

    const entry = await fetchOne(fixture);

    const written = await fileOf(fixture, `fake-${A}.en.plain.txt`);
    const body = bodyOf(written);
    expect(body.split("\n").every((line) => line.length <= LINE_LIMIT)).toBe(
      true,
    );
    expect(body.replaceAll("\n", " ")).toBe(text);
    expect(entry).toMatchObject({
      ok: true,
      value: {
        charCount: written.length,
        lineCount: written.split("\n").length,
      },
    });
  });

  it("starts the saved file with the untrusted content notice on its own line", async () => {
    const fixture = setup({
      overrides: returning(sentence(30)),
      config: TINY_BUDGET,
    });

    await fetchOne(fixture);

    const written = await fileOf(fixture, `fake-${A}.en.plain.txt`);
    expect(written.split("\n").slice(0, 2)).toEqual([UNTRUSTED_NOTICE, ""]);
    expect(bodyOf(written).startsWith("word0 word1")).toBe(true);
  });

  it("limits the preview to the preview length of the text and omits the text field", async () => {
    const fixture = setup({
      overrides: returning(sentence(2_000)),
      config: TINY_BUDGET,
    });

    const entry = await fetchOne(fixture);

    const written = await fileOf(fixture, `fake-${A}.en.plain.txt`);
    expect(entry).toMatchObject({
      ok: true,
      value: {
        mode: "file",
        preview: bodyOf(written).slice(0, PREVIEW_CHARS),
      },
    });
    expect(entry).not.toHaveProperty("value.text");
  });

  it("names files differently with and without timestamps", async () => {
    const fixture = setup({
      overrides: returning(sentence(30)),
      config: TINY_BUDGET,
    });

    await fetchOne(fixture);
    await fetchOne(fixture, { timestamps: true });

    expect(await readdir(join(fixture.root, "transcripts"))).toEqual([
      `fake-${A}.en.plain.txt`,
      `fake-${A}.en.timestamps.txt`,
    ]);
  });

  it("replaces characters that are unsafe in a file name", async () => {
    const fixture = setup({
      overrides: {
        getTranscript: async (ref) =>
          ok(transcriptOf({ ...ref, id: "../x y" }, sentence(30))),
      },
      config: TINY_BUDGET,
    });

    const entry = await fetchOne(fixture);

    expect(entry).toMatchObject({
      ok: true,
      value: {
        mode: "file",
        filePath: join(fixture.root, "transcripts", "fake-___x_y.en.plain.txt"),
      },
    });
    expect(await readdir(join(fixture.root, "transcripts"))).toEqual([
      "fake-___x_y.en.plain.txt",
    ]);
  });

  it.each([
    ["inline when it still fits", 0, "inline"],
    ["to a file when the failure used the room", 1, "file"],
  ])(
    "charges a failed item its text, so the next transcript goes %s",
    async (_label, extra, mode) => {
      const failureSize = 2 * watchUrl(A).length + "No captions".length;
      const fixture = setup({
        overrides: {
          getTranscript: async (ref) =>
            ref.id === A
              ? err("NO_CAPTIONS", "No captions")
              : ok(
                  transcriptOf(
                    ref,
                    "z".repeat(TEST_BUDGET - failureSize + extra),
                  ),
                ),
        },
      });

      const outcome = await fixture.services.transcripts.fetch({
        urls: [watchUrl(A), watchUrl(B)],
        ...EN,
      });

      expect(outcome.entries[1]).toMatchObject({ ok: true, value: { mode } });
    },
  );

  it("keeps the whole text of a failed item that fits the budget", async () => {
    const hint = "h".repeat(MAX_FAILURE_TEXT_CHARS + 100);
    const fixture = setup({
      overrides: {
        getTranscript: async () => err("NO_CAPTIONS", "none", hint),
      },
      config: { transcriptCharBudget: TEST_BUDGET * 2 },
    });

    const entry = await fetchOne(fixture);

    expect(entry).toMatchObject({ ok: false, error: { hint } });
  });

  it("returns every failed item once the budget is spent, with message and hint cut short", async () => {
    const long = "x".repeat(MAX_FAILURE_TEXT_CHARS * 4);
    const fixture = setup({
      overrides: {
        getTranscript: async () => err("PROCESS_FAILED", long, long),
      },
    });
    const urls = Array.from({ length: MAX_ITEMS }, (_, i) =>
      watchUrl(videoId(i)),
    );

    const { entries } = await fixture.services.transcripts.fetch({
      urls,
      ...EN,
    });

    expect(entries).toHaveLength(MAX_ITEMS);
    for (const entry of entries) {
      const error = entry.ok ? undefined : entry.error;
      expect(error?.message).toHaveLength(MAX_FAILURE_TEXT_CHARS);
      expect(error?.hint).toHaveLength(MAX_FAILURE_TEXT_CHARS);
    }
  });

  it("never returns more preview text for file entries than the budget charged them", async () => {
    const fixture = setup({
      overrides: returning((id) => `${id} ${sentence(400)}`),
      config: TINY_BUDGET,
    });
    const urls = Array.from({ length: MAX_ITEMS }, (_, i) =>
      watchUrl(videoId(i)),
    );

    const { entries } = await fixture.services.transcripts.fetch({
      urls,
      ...EN,
    });

    const previews = entries.map((entry) =>
      entry.ok && entry.value.mode === "file" ? entry.value.preview.length : -1,
    );
    expect(
      previews.every((length) => length > 0 && length <= PREVIEW_CHARS),
    ).toBe(true);
    const charged = MAX_ITEMS * (PREVIEW_CHARS + FILE_ENTRY_OVERHEAD_CHARS);
    const returned = previews.reduce((sum, length) => sum + length, 0);
    expect(
      returned + MAX_ITEMS * FILE_ENTRY_OVERHEAD_CHARS,
    ).toBeLessThanOrEqual(charged);
  });

  it("never writes through a symlink that already sits at the file name", async () => {
    const fixture = setup({
      overrides: returning(sentence(30)),
      config: TINY_BUDGET,
    });
    const victim = join(temp.path, "victim.txt");
    await writeFile(victim, "precious");
    await mkdir(join(fixture.root, "transcripts"), { recursive: true });
    const link = join(fixture.root, "transcripts", `fake-${A}.en.plain.txt`);
    await symlink(victim, link);

    await fetchOne(fixture);

    expect(await readFile(victim, "utf8")).toBe("precious");
    expect((await stat(link)).isFile()).toBe(true);
    const written = await readFile(link, "utf8");
    expect(written.startsWith(`${UNTRUSTED_NOTICE}\n\n`)).toBe(true);
    expect(bodyOf(written).replaceAll("\n", " ")).toBe(sentence(30));
  });

  it("leaves no temporary file behind", async () => {
    const fixture = setup({
      overrides: returning(sentence(30)),
      config: TINY_BUDGET,
    });

    await fetchOne(fixture);

    expect(await readdir(join(fixture.root, "transcripts"))).toEqual([
      `fake-${A}.en.plain.txt`,
    ]);
  });

  it("fails only the file item when the transcripts folder cannot be created", async () => {
    const fixture = setup({
      overrides: returning((id) => `${id} ${sentence(60)}`),
      config: { transcriptCharBudget: 500 },
    });
    await mkdir(fixture.root, { recursive: true });
    await writeFile(join(fixture.root, "transcripts"), "in the way");

    const outcome = await fixture.services.transcripts.fetch({
      urls: [watchUrl(A), watchUrl(B)],
      ...EN,
    });

    expect(outcome.entries).toMatchObject([
      { ok: true, value: { mode: "inline" } },
      { ok: false, error: { code: "IO_FAILED" } },
    ]);
  });

  it("fails the file item and removes its temporary file when the target cannot be replaced", async () => {
    const fixture = setup({
      overrides: returning(sentence(30)),
      config: TINY_BUDGET,
    });
    const target = join(fixture.root, "transcripts", `fake-${A}.en.plain.txt`);
    await mkdir(join(target, "occupied"), { recursive: true });

    const entry = await fetchOne(fixture);

    expect(entry).toMatchObject({
      ok: false,
      error: {
        code: "IO_FAILED",
        message: expect.stringContaining(`fake-${A}.en.plain.txt`),
      },
    });
    expect(await readdir(join(fixture.root, "transcripts"))).toEqual([
      `fake-${A}.en.plain.txt`,
    ]);
  });
});
