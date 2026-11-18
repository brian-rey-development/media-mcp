import type {
  BatchOutcome,
  Services,
  TranscriptDelivery,
} from "@media-mcp/core";
import {
  FILE_ENTRY_OVERHEAD_CHARS,
  MAX_LANGUAGE_LENGTH,
  PREVIEW_CHARS,
  UNTRUSTED_NOTICE,
} from "@media-mcp/core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_READ_MAX_ITEMS } from "../src/tools/limits.js";
import { callTool, textOf, withClient } from "./support/client.js";
import {
  failedWith,
  fakeServices,
  inlineTranscript,
  outcomeOf,
  requireSignal,
  succeeded,
} from "./support/fake-services.js";
import { PLAYLIST_URL, REF_A, URL_A, URL_B } from "./support/fixtures.js";

const MAX_TITLE_CHARS = 200;
const MAX_CHANNEL_CHARS = 100;
const MAX_PATH_CHARS = 300;
const LARGEST_COUNT = 9_999_999;

type TranscriptFetch = Services["transcripts"]["fetch"];

const servicesReturning = (
  ...entries: BatchOutcome<TranscriptDelivery>["entries"]
) => fakeServices({ transcripts: async () => outcomeOf(entries) });

type FileTranscript = Extract<TranscriptDelivery, { mode: "file" }>;

const fileTranscript = (preview: string): FileTranscript => ({
  ...inlineTranscript(REF_A, ""),
  mode: "file",
  filePath: "/out/transcripts/fake-vidAAAAAAAA.en.plain.txt",
  preview,
  charCount: 1_234,
  lineCount: 13,
});

describe("get_transcripts", () => {
  it("applies the defaults and returns structured content plus a text block", async () => {
    const fetch = vi.fn<TranscriptFetch>(async () =>
      outcomeOf([
        succeeded(URL_A, inlineTranscript(REF_A, "hello there world")),
      ]),
    );

    const result = await callTool(
      fakeServices({ transcripts: fetch }),
      "get_transcripts",
      { urls: [URL_A] },
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: [URL_A],
        language: "en",
        timestamps: false,
        maxItems: DEFAULT_READ_MAX_ITEMS,
        startIndex: 1,
      }),
      expect.any(AbortSignal),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      entries: [
        {
          url: URL_A,
          inputUrl: URL_A,
          ok: true,
          videoId: "vidAAAAAAAA",
          title: "Title vidAAAAAAAA",
          channel: "A channel",
          language: "en",
          source: "manual",
          wordCount: 3,
          mode: "inline",
          text: "hello there world",
        },
      ],
      truncations: [],
    });
    expect(textOf(result.content)).toContain("hello there world");
  });

  it("passes the language, timestamps and startIndex choices to the service", async () => {
    const fetch = vi.fn<TranscriptFetch>(async () => outcomeOf([]));

    await callTool(fakeServices({ transcripts: fetch }), "get_transcripts", {
      urls: [URL_A],
      language: "pt-BR",
      timestamps: true,
      maxItems: 3,
      startIndex: 11,
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: [URL_A],
        language: "pt-BR",
        timestamps: true,
        maxItems: 3,
        startIndex: 11,
      }),
      expect.any(AbortSignal),
    );
  });

  it("names the channel in the header and keeps the link the caller passed", async () => {
    const services = servicesReturning(
      succeeded(URL_A, inlineTranscript(REF_A, "words"), "https://short/a"),
    );

    const result = await callTool(services, "get_transcripts", {
      urls: ["https://short/a"],
    });

    expect(result.structuredContent).toMatchObject({
      entries: [{ url: URL_A, inputUrl: "https://short/a" }],
    });
    expect(textOf(result.content)).toContain(
      '## "Title vidAAAAAAAA" by "A channel" (en, manual, 1 words)',
    );
  });

  it("renders a file item with its path, size, a quoted preview and how to read it", async () => {
    const services = servicesReturning(
      succeeded(URL_A, fileTranscript("the opening words")),
    );

    const result = await callTool(services, "get_transcripts", {
      urls: [URL_A],
    });

    expect(result.structuredContent).toMatchObject({
      entries: [
        {
          mode: "file",
          preview: "the opening words",
          charCount: 1_234,
          lineCount: 13,
        },
      ],
    });
    const text = textOf(result.content);
    expect(text).toContain(
      `Saved to /out/transcripts/fake-vidAAAAAAAA.en.plain.txt (1234 chars, 13 lines). Preview below is the first ${PREVIEW_CHARS} characters only. Read it with read_transcript_file, or with your file tools when the server runs on your machine.`,
    );
    expect(text).toContain('Preview: "the opening words"');
    expect(text).toContain(UNTRUSTED_NOTICE);
    expect(text).not.toContain("<untrusted_content");
  });

  it("keeps the largest realistic file entry without its preview within the overhead the budget allows for", async () => {
    const largest: FileTranscript = {
      ...fileTranscript(""),
      title: "t".repeat(MAX_TITLE_CHARS),
      channel: "c".repeat(MAX_CHANNEL_CHARS),
      language: "l".repeat(MAX_LANGUAGE_LENGTH),
      filePath: `/${"p".repeat(MAX_PATH_CHARS - 1)}`,
      wordCount: LARGEST_COUNT,
      charCount: LARGEST_COUNT,
      lineCount: LARGEST_COUNT,
    };

    const result = await callTool(
      servicesReturning(succeeded(URL_A, largest)),
      "get_transcripts",
      { urls: [URL_A] },
    );

    expect(textOf(result.content).length).toBeLessThanOrEqual(
      FILE_ENTRY_OVERHEAD_CHARS,
    );
  });

  it("reports a failed entry with its code and keeps the others, without isError", async () => {
    const services = servicesReturning(
      succeeded(URL_A, inlineTranscript(REF_A, "fine")),
      failedWith(URL_B, {
        code: "NO_CAPTIONS",
        message: "No captions",
        hint: "Available languages: none",
      }),
    );

    const result = await callTool(services, "get_transcripts", {
      urls: [URL_A, URL_B],
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      entries: [
        { url: URL_A, ok: true },
        {
          url: URL_B,
          inputUrl: URL_B,
          ok: false,
          error: {
            code: "NO_CAPTIONS",
            message: "No captions",
            hint: "Available languages: none",
          },
        },
      ],
    });
    const text = textOf(result.content);
    expect(text).toMatch(/NO_CAPTIONS.*No captions/s);
    expect(text).toContain("Available languages: none");
  });

  it("tells how to continue a cut playlist in both outputs", async () => {
    const services = fakeServices({
      transcripts: async () =>
        outcomeOf(
          [],
          [
            {
              source: PLAYLIST_URL,
              total: 93,
              totalExact: true,
              included: 50,
              nextStartIndex: 51,
            },
          ],
        ),
    });

    const result = await callTool(services, "get_transcripts", {
      urls: [PLAYLIST_URL],
    });

    expect(result.structuredContent).toMatchObject({
      truncations: [{ total: 93, included: 50, nextStartIndex: 51 }],
    });
    expect(textOf(result.content)).toContain(
      `${PLAYLIST_URL} has 93 videos, only 50 were included. Call again with startIndex=51 to continue.`,
    );
  });

  it("says at least when the playlist total is only a lower bound", async () => {
    const services = fakeServices({
      transcripts: async () =>
        outcomeOf(
          [],
          [
            {
              source: PLAYLIST_URL,
              total: 51,
              totalExact: false,
              included: 50,
              nextStartIndex: 51,
            },
          ],
        ),
    });

    const result = await callTool(services, "get_transcripts", {
      urls: [PLAYLIST_URL],
    });

    expect(textOf(result.content)).toContain(
      `${PLAYLIST_URL} has at least 51 videos, only 50 were included.`,
    );
  });

  it("says a link was left out when the cap was reached before it", async () => {
    const services = fakeServices({
      transcripts: async () =>
        outcomeOf([], [{ source: URL_B, included: 0, totalExact: false }]),
    });

    const result = await callTool(services, "get_transcripts", {
      urls: [URL_B],
    });

    expect(textOf(result.content)).toContain(
      `${URL_B} was left out because maxItems was reached`,
    );
  });

  it("rejects the call with an abort error and aborts the signal the service received", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const services = fakeServices({
      transcripts: (_input, signal) => {
        started.resolve(requireSignal(signal));
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();

    await withClient(services, async (client) => {
      const pending = client.callTool(
        { name: "get_transcripts", arguments: { urls: [URL_A] } },
        undefined,
        { signal: controller.signal },
      );
      const serviceSignal = await started.promise;
      controller.abort();

      await expect(pending).rejects.toThrow(/AbortError/);
      expect(serviceSignal.aborted).toBe(true);
    });
  });

  it("reports progress as each video is fetched", async () => {
    const seen: {
      progress: number;
      total?: number | undefined;
      message?: string | undefined;
    }[] = [];
    const services = fakeServices({
      transcripts: async ({ onPlan, onItemDone }) => {
        onPlan?.(2);
        onItemDone?.(REF_A);
        onItemDone?.({ ...REF_A, id: "vidBBBBBBBB" });
        return outcomeOf([]);
      },
    });

    await callTool(
      services,
      "get_transcripts",
      { urls: [URL_A] },
      { onprogress: (progress: (typeof seen)[number]) => seen.push(progress) },
    );

    expect(seen.at(-1)).toMatchObject({
      progress: 2,
      total: 2,
      message: "Fetched vidBBBBBBBB",
    });
  });
});
