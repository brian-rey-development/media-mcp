import { readFile } from "node:fs/promises";
import { ERROR_CODES, MAX_FAILURE_TEXT_CHARS } from "@media-mcp/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { downloadMedia } from "../src/tools/download-media.js";
import { getTranscripts } from "../src/tools/get-transcripts.js";
import { getVideoInfo } from "../src/tools/get-video-info.js";
import { MAX_ITEMS } from "../src/tools/limits.js";
import { callTool, entriesOf, textOf } from "./support/client.js";
import { pipelineServices } from "./support/fake-ytdlp-pipeline.js";
import { withTempDir } from "./support/temp-dir.js";

const SINTEL = "https://www.youtube.com/watch?v=eRsGyueVLvQ";
const SINTEL_SHORT = "https://youtu.be/eRsGyueVLvQ";
const GONE = "https://www.youtube.com/watch?v=unavailabl1";
const PLAYLIST =
  "https://www.youtube.com/playlist?list=PLa1F2ddGya_84ye1JAvIGh0Yp7utEKZI_";
const SMALL_BUDGET = { MEDIA_MCP_CHAR_BUDGET: "100" };

const HUGE_ERROR_CHARS = 5_000;
const LONGEST_CODE = Math.max(...ERROR_CODES.map((code) => code.length));
const FRAMING_CHARS = 40;
const ENTRY_JSON_CHARS = 200;

type ToolOutput = z.ZodRawShape;
type CallResult = Awaited<ReturnType<typeof callTool>>;

const exactlyMatches = (output: ToolOutput, result: CallResult): void => {
  const parsed = z.object(output).parse(result.structuredContent);
  expect(parsed).toEqual(result.structuredContent);
};

afterEach(() => vi.unstubAllEnvs());

describe("the tools with the real services and a fake yt-dlp", () => {
  const temp = withTempDir("media-mcp-pipe-");

  const call = (
    name: string,
    args: Record<string, unknown>,
    env: Record<string, string> = {},
  ) => callTool(pipelineServices(temp.path, env), name, args);

  it("returns an inline transcript the output schema accepts, with the channel and the link passed", async () => {
    const result = await call("get_transcripts", { urls: [SINTEL_SHORT] });

    expect(result.isError).toBeUndefined();
    exactlyMatches(getTranscripts.output, result);
    expect(entriesOf(result)).toMatchObject([
      {
        ok: true,
        mode: "inline",
        url: SINTEL,
        inputUrl: SINTEL_SHORT,
        channel: "Blender",
        language: "en",
        source: "manual",
      },
    ]);
    expect(textOf(result.content)).toContain("<untrusted_content");
  });

  it("returns a failed entry for a language the video does not offer", async () => {
    const result = await call("get_transcripts", {
      urls: [SINTEL],
      language: "xx",
    });

    expect(result.isError).toBeUndefined();
    exactlyMatches(getTranscripts.output, result);
    expect(entriesOf(result)).toMatchObject([
      {
        ok: false,
        error: {
          code: "NO_CAPTIONS",
          hint: expect.stringContaining("Retry with language set to"),
        },
      },
    ]);
  });

  it("returns a failed entry for an unavailable video next to a good one", async () => {
    const result = await call("get_transcripts", { urls: [GONE, SINTEL] });

    exactlyMatches(getTranscripts.output, result);
    expect(entriesOf(result)).toMatchObject([
      { ok: false, error: { code: "VIDEO_UNAVAILABLE" } },
      { ok: true },
    ]);
  });

  it("returns a file entry with its size when the text is over the budget", async () => {
    const result = await call(
      "get_transcripts",
      { urls: [SINTEL] },
      SMALL_BUDGET,
    );

    expect(result.isError).toBeUndefined();
    exactlyMatches(getTranscripts.output, result);
    const [entry] = entriesOf(result);
    expect(entry).toMatchObject({ ok: true, mode: "file", channel: "Blender" });
    const { filePath, charCount, lineCount } = z
      .object({
        filePath: z.string(),
        charCount: z.number(),
        lineCount: z.number(),
      })
      .parse(entry);
    const written = await readFile(filePath, "utf8");
    expect(written).toHaveLength(charCount);
    expect(written.split("\n")).toHaveLength(lineCount);
    expect(textOf(result.content)).toContain(
      `Saved to ${filePath} (${charCount} chars, ${lineCount} lines)`,
    );
  });

  it("reports a cut playlist with its total and where to continue", async () => {
    const result = await call("get_transcripts", {
      urls: [PLAYLIST],
      maxItems: 2,
    });

    expect(result.isError).toBeUndefined();
    exactlyMatches(getTranscripts.output, result);
    expect(result.structuredContent).toMatchObject({
      truncations: [
        {
          source: PLAYLIST,
          total: 93,
          totalExact: true,
          included: 2,
          nextStartIndex: 3,
        },
      ],
    });
    expect(textOf(result.content)).toContain(
      "Call again with startIndex=3 to continue.",
    );
  });

  it("returns video info with caption languages, chapters and a description on request", async () => {
    const result = await call("get_video_info", {
      urls: [SINTEL, GONE],
      includeDescription: true,
    });

    expect(result.isError).toBeUndefined();
    exactlyMatches(getVideoInfo.output, result);
    expect(entriesOf(result)).toMatchObject([
      {
        ok: true,
        channel: "Blender",
        durationSeconds: 888,
        descriptionTruncated: false,
        captionLanguages: {
          manual: expect.arrayContaining(["en"]),
          auto: expect.arrayContaining(["en"]),
        },
      },
      { ok: false, error: { code: "VIDEO_UNAVAILABLE" } },
    ]);
    const text = textOf(result.content);
    expect(text).toContain(
      'Chapters:\n0:00 "Introduction"\n1:33 "The quest for the dragon"',
    );
    expect(text).toContain('Description:\n<untrusted_content source="');
  });

  it("downloads a file the output schema accepts", async () => {
    const result = await call("download_media", {
      urls: [SINTEL],
      kind: "audio",
    });

    expect(result.isError).toBeUndefined();
    exactlyMatches(downloadMedia.output, result);
    expect(entriesOf(result)).toMatchObject([
      { ok: true, kind: "audio", inputUrl: SINTEL, bytes: 16 },
    ]);
    expect(textOf(result.content)).toContain("Saved audio to");
  });

  it("keeps a batch where every video failed within what the failure caps allow", async () => {
    vi.stubEnv("FAKE_YTDLP_ERROR_CHARS", String(HUGE_ERROR_CHARS));
    const urls = Array.from(
      { length: MAX_ITEMS },
      (_, index) =>
        `https://www.youtube.com/watch?v=fail${String(index).padStart(7, "0")}`,
    );

    const result = await call("get_transcripts", { urls });

    expect(entriesOf(result)).toHaveLength(MAX_ITEMS);
    expect(entriesOf(result).every((entry) => entry.ok === false)).toBe(true);
    const perEntry = LONGEST_CODE + 2 * MAX_FAILURE_TEXT_CHARS + FRAMING_CHARS;
    const linkChars = urls.join("").length;
    expect(textOf(result.content).length).toBeLessThanOrEqual(
      linkChars + MAX_ITEMS * perEntry,
    );
    expect(JSON.stringify(result.structuredContent).length).toBeLessThanOrEqual(
      2 * linkChars + MAX_ITEMS * (perEntry + ENTRY_JSON_CHARS),
    );
  });
});
