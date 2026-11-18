import { MAX_TRANSCRIPT_PAGE_LINES, MAX_URL_LENGTH } from "@media-mcp/core";
import { describe, expect, it, vi } from "vitest";
import { MAX_OUTPUT_DIR_LENGTH } from "../src/tools/download-media.js";
import { tools } from "../src/tools/index.js";
import { MAX_ITEMS } from "../src/tools/limits.js";
import { MAX_TRANSCRIPT_PATH_LENGTH } from "../src/tools/read-transcript-file.js";
import { callTool, textOf } from "./support/client.js";
import { fakeServices } from "./support/fake-services.js";
import { tooManyUrls, URL_A } from "./support/fixtures.js";

const REQUIRED_EXTRAS: Record<string, Record<string, unknown>> = {
  download_media: { kind: "video" },
};

const URL_TOOLS = tools
  .filter(({ input }) => "urls" in input)
  .map(({ name }) => ({ name, extra: REQUIRED_EXTRAS[name] ?? {} }));
const PAGE_TOOLS = tools.filter(({ input }) => !("urls" in input));

const OVERSIZED_URL = `https://www.youtube.com/watch?v=${"a".repeat(MAX_URL_LENGTH)}`;

const INVALID = [
  ["urls", "a link over the length cap", { urls: [OVERSIZED_URL] }],
  ["urls", "an empty list", { urls: [] }],
  ["urls", `${MAX_ITEMS + 1} links`, { urls: tooManyUrls() }],
  ["maxItems", "maxItems 0", { urls: [URL_A], maxItems: 0 }],
  [
    "maxItems",
    `maxItems ${MAX_ITEMS + 1}`,
    { urls: [URL_A], maxItems: MAX_ITEMS + 1 },
  ],
  ["maxItems", "a fractional maxItems", { urls: [URL_A], maxItems: 1.5 }],
  ["startIndex", "startIndex 0", { urls: [URL_A], startIndex: 0 }],
  ["startIndex", "a fractional startIndex", { urls: [URL_A], startIndex: 2.5 }],
] as const;

const INVALID_LANGUAGES = [
  "all",
  ".*",
  "en,es",
  "",
  "english",
  "en us",
] as const;

describe.each(URL_TOOLS)("$name input validation", ({ name, extra }) => {
  it.each(INVALID)(
    "names %s when given %s and never calls the service",
    async (field, _label, args) => {
      const service = vi.fn();
      const services = fakeServices({
        transcripts: service,
        info: service,
        downloads: service,
      });

      const result = await callTool(services, name, { ...extra, ...args });

      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toContain(field);
      expect(service).not.toHaveBeenCalled();
    },
  );
});

describe.each(URL_TOOLS)("$name oversized input", ({ name, extra }) => {
  it("rejects a huge link without echoing it back", async () => {
    const huge = `https://www.youtube.com/watch?v=${"a".repeat(200_000)}`;
    const service = vi.fn();
    const services = fakeServices({
      transcripts: service,
      info: service,
      downloads: service,
    });

    const result = await callTool(services, name, { ...extra, urls: [huge] });

    expect(result.isError).toBe(true);
    expect(textOf(result.content)).not.toContain("aaaaaaaaaa");
    expect(service).not.toHaveBeenCalled();
  });

  it("accepts a link exactly at the length cap", async () => {
    const atCap = OVERSIZED_URL.slice(0, MAX_URL_LENGTH);
    const service = vi.fn(async () => ({ entries: [], truncations: [] }));
    const services = fakeServices({
      transcripts: service,
      info: service,
      downloads: service,
    });

    const result = await callTool(services, name, { ...extra, urls: [atCap] });

    expect(result.isError).toBeUndefined();
    expect(service).toHaveBeenCalledOnce();
  });
});

const PAGE_PATH = "/out/transcripts/a.plain.txt";

const INVALID_PAGES = [
  ["path", "no path", {}],
  [
    "path",
    "a path over the length cap",
    { path: "p".repeat(MAX_TRANSCRIPT_PATH_LENGTH + 1) },
  ],
  ["startLine", "startLine 0", { path: PAGE_PATH, startLine: 0 }],
  ["startLine", "a fractional startLine", { path: PAGE_PATH, startLine: 1.5 }],
  ["maxLines", "maxLines 0", { path: PAGE_PATH, maxLines: 0 }],
  [
    "maxLines",
    `maxLines ${MAX_TRANSCRIPT_PAGE_LINES + 1}`,
    { path: PAGE_PATH, maxLines: MAX_TRANSCRIPT_PAGE_LINES + 1 },
  ],
  ["maxLines", "a fractional maxLines", { path: PAGE_PATH, maxLines: 2.5 }],
] as const;

describe("tools without links", () => {
  it("are only read_transcript_file, which the cases below cover", () => {
    expect(PAGE_TOOLS.map(({ name }) => name)).toEqual([
      "read_transcript_file",
    ]);
  });

  it.each(INVALID_PAGES)(
    "read_transcript_file names %s when given %s and never calls the service",
    async (field, _label, args) => {
      const service = vi.fn();

      const result = await callTool(
        fakeServices({ transcriptFiles: service }),
        "read_transcript_file",
        args,
      );

      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toContain(field);
      expect(service).not.toHaveBeenCalled();
    },
  );

  it("read_transcript_file accepts a path exactly at the length cap", async () => {
    const service = vi.fn(async () => ({
      ok: true as const,
      value: { path: "p", startLine: 1, lineCount: 0, totalLines: 0, text: "" },
    }));

    const result = await callTool(
      fakeServices({ transcriptFiles: service }),
      "read_transcript_file",
      { path: "p".repeat(MAX_TRANSCRIPT_PATH_LENGTH) },
    );

    expect(result.isError).toBeUndefined();
    expect(service).toHaveBeenCalledOnce();
  });
});

describe("download_media outputDir length", () => {
  it("rejects an outputDir over the cap before calling the service", async () => {
    const service = vi.fn();

    const result = await callTool(
      fakeServices({ downloads: service }),
      "download_media",
      {
        urls: [URL_A],
        kind: "video",
        outputDir: "d".repeat(MAX_OUTPUT_DIR_LENGTH + 1),
      },
    );

    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain("outputDir");
    expect(service).not.toHaveBeenCalled();
  });
});

describe("get_transcripts language validation", () => {
  it.each(INVALID_LANGUAGES)(
    "rejects the language %j before calling the service",
    async (language) => {
      const service = vi.fn();

      const result = await callTool(
        fakeServices({ transcripts: service }),
        "get_transcripts",
        { urls: [URL_A], language },
      );

      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toContain("language");
      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(["en", "pt-BR", "es-419"])(
    "accepts the language %s",
    async (language) => {
      const service = vi.fn(async () => ({ entries: [], truncations: [] }));

      const result = await callTool(
        fakeServices({ transcripts: service }),
        "get_transcripts",
        { urls: [URL_A], language },
      );

      expect(result.isError).toBeUndefined();
      expect(service).toHaveBeenCalledOnce();
    },
  );
});
