import type { Services } from "@media-mcp/core";
import { describe, expect, it, vi } from "vitest";
import { createLifecycle } from "../src/lifecycle.js";
import { DEFAULT_DOWNLOAD_MAX_ITEMS, MAX_ITEMS } from "../src/tools/limits.js";
import { callTool, textOf, withClient } from "./support/client.js";
import {
  downloadedFile,
  fakeServices,
  outcomeOf,
  succeeded,
} from "./support/fake-services.js";
import { INJECTED_URLS, REF_A, URL_A } from "./support/fixtures.js";
import { type RealServices, realServices } from "./support/real-services.js";
import { withTempDir } from "./support/temp-dir.js";

const DONE = 100;
const HALFWAY = 50;

type Run = Services["downloads"]["run"];

const runReturning = (...refs: (typeof REF_A)[]) =>
  vi.fn<Run>(async () =>
    outcomeOf(refs.map((ref) => succeeded(ref.url, downloadedFile(ref)))),
  );

const download = (run: Run, args: Record<string, unknown>, options?: object) =>
  callTool(fakeServices({ downloads: run }), "download_media", args, options);

const progressSeen = async (run: Run) => {
  const seen: { progress: number; total?: number | undefined }[] = [];
  await download(
    run,
    { urls: [URL_A], kind: "video" },
    {
      onprogress: (progress: (typeof seen)[number]) => seen.push(progress),
    },
  );
  return seen;
};

describe("download_media", () => {
  it("applies the default quality and cap and passes kind and outputDir on", async () => {
    const run = runReturning(REF_A);

    const result = await download(run, {
      urls: [URL_A],
      kind: "audio",
      outputDir: "clips",
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: [URL_A],
        kind: "audio",
        quality: "1080p",
        outputDir: "clips",
        maxItems: DEFAULT_DOWNLOAD_MAX_ITEMS,
        startIndex: 1,
      }),
      expect.any(AbortSignal),
    );
    expect(result.structuredContent).toEqual({
      entries: [
        {
          url: URL_A,
          inputUrl: URL_A,
          ok: true,
          videoId: "vidAAAAAAAA",
          filePath: "/out/vidAAAAAAAA.mp4",
          kind: "video",
          bytes: 42,
        },
      ],
      truncations: [],
    });
  });

  it("writes a compact summary with the saved path and size", async () => {
    const result = await download(runReturning(REF_A), {
      urls: [URL_A],
      kind: "video",
    });

    expect(textOf(result.content)).toBe(
      "Saved video to /out/vidAAAAAAAA.mp4 (42 bytes)",
    );
  });

  it("accepts a quality and omits outputDir when none is given", async () => {
    const run = runReturning();

    await download(run, { urls: [URL_A], kind: "video", quality: "480p" });

    const [input] = run.mock.calls[0] ?? [];
    expect(input).toMatchObject({ kind: "video", quality: "480p" });
    expect(input).not.toHaveProperty("outputDir");
  });

  it.each([
    ["kind", "an unknown kind", { urls: [URL_A], kind: "gif" }],
    ["kind", "a missing kind", { urls: [URL_A] }],
    [
      "quality",
      "an unknown quality",
      { urls: [URL_A], kind: "video", quality: "4k" },
    ],
  ])(
    "names %s when given %s and never calls the service",
    async (field, _label, args) => {
      const run = runReturning();

      const result = await download(run, args);

      expect(result.isError).toBe(true);
      expect(textOf(result.content)).toContain(field);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("accepts maxItems up to the limit", async () => {
    const run = runReturning();

    const result = await download(run, {
      urls: [URL_A],
      kind: "video",
      maxItems: MAX_ITEMS,
    });

    expect(result.isError).toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
  });

  it("turns service progress into progress notifications against the planned total", async () => {
    const seen = await progressSeen(async ({ onPlan, onProgress }) => {
      onPlan?.(1);
      onProgress?.(REF_A, HALFWAY);
      return outcomeOf([]);
    });

    expect(seen).toContainEqual(
      expect.objectContaining({ progress: HALFWAY, total: DONE }),
    );
  });

  it("sends a finishing notification when the downloads are done", async () => {
    const seen = await progressSeen(async ({ onPlan, onProgress }) => {
      onPlan?.(1);
      onProgress?.(REF_A, DONE);
      return outcomeOf([succeeded(URL_A, downloadedFile(REF_A))]);
    });

    expect(seen.at(-1)).toMatchObject({
      progress: DONE,
      total: DONE,
      message: "Finished downloading",
    });
  });

  it("does not announce a finish when the call was cancelled", async () => {
    const lifecycle = createLifecycle();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const run: Run = async ({ onPlan, onProgress }) => {
      onPlan?.(1);
      onProgress?.(REF_A, HALFWAY);
      started.resolve();
      await release.promise;
      return outcomeOf([]);
    };
    const messages: (string | undefined)[] = [];

    await withClient(
      fakeServices({ downloads: run }),
      async (client) => {
        const call = client.callTool(
          {
            name: "download_media",
            arguments: { urls: [URL_A], kind: "video" },
          },
          undefined,
          { onprogress: ({ message }) => messages.push(message) },
        );
        await started.promise;
        lifecycle.abort();
        release.resolve();
        await call;
      },
      lifecycle,
    );

    expect(messages).toEqual([`Downloading ${REF_A.id}, ${HALFWAY}%`]);
  });

  it("completes normally when the client did not ask for progress", async () => {
    const run = vi.fn<Run>(async ({ onProgress }) => {
      onProgress?.(REF_A, HALFWAY);
      return outcomeOf([succeeded(URL_A, downloadedFile(REF_A))]);
    });

    const result = await download(run, { urls: [URL_A], kind: "video" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ entries: [{ ok: true }] });
  });
});

describe("download_media with the real services", () => {
  const temp = withTempDir("media-mcp-dl-");
  let real: RealServices;

  const downloadWithReal = (args: Record<string, unknown>) => {
    real = realServices(temp.path);
    return callTool(real.services, "download_media", {
      kind: "video",
      ...args,
    });
  };

  it.each(["../escape", "/etc"])(
    "returns a failed entry with OUTPUT_PATH_ESCAPE for outputDir %j",
    async (outputDir) => {
      const result = await downloadWithReal({ urls: [URL_A], outputDir });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        entries: [
          { url: URL_A, ok: false, error: { code: "OUTPUT_PATH_ESCAPE" } },
        ],
      });
      expect(real.processCalls()).toBe(0);
    },
  );

  it("treats option-like and non-web inputs as failed entries without starting a process", async () => {
    const result = await downloadWithReal({ urls: INJECTED_URLS });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      entries: INJECTED_URLS.map((url) => ({
        url,
        ok: false,
        error: { code: "INVALID_URL" },
      })),
    });
    expect(real.processCalls()).toBe(0);
  });
});
