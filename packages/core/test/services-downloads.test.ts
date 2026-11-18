import { mkdir, readdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../src/domain/result.js";
import type { Provider } from "../src/providers/provider.js";
import type { DownloadRequest } from "../src/services/types.js";
import {
  PLAYLIST_TOTAL,
  PLAYLIST_URL,
  videoId,
  watchUrl,
} from "./support/fake-provider.js";
import { FIRST_ITEM, servicesFixture } from "./support/services-fixture.js";

const JOIN_WAIT_MS = 50;
const A = videoId(1);
const B = videoId(2);

const request = (
  overrides: Partial<DownloadRequest> = {},
): DownloadRequest => ({
  urls: [watchUrl(A)],
  kind: "video",
  quality: "720p",
  maxItems: 10,
  startIndex: FIRST_ITEM,
  ...overrides,
});

describe("downloads", () => {
  const { setup, temp } = servicesFixture();

  it("is never cached", async () => {
    const { services, calls } = setup();

    await services.downloads.run(request());
    await services.downloads.run(request());

    expect(calls.download).toHaveLength(2);
  });

  it("hands the provider the kind, quality and the resolved output directory", async () => {
    const download = vi.fn<Provider["download"]>(async (ref, options) =>
      ok({ ref, filePath: "/f", kind: options.kind, bytes: 1 }),
    );
    const { services, root } = setup({ overrides: { download } });

    await services.downloads.run(request({ outputDir: "clips/week1" }));

    expect(download.mock.calls[0]?.[1]).toMatchObject({
      kind: "video",
      quality: "720p",
      outputDir: join(root, "clips", "week1"),
    });
  });

  it("creates the output directory once a video is going to be downloaded", async () => {
    const { services, root } = setup();

    await services.downloads.run(request({ outputDir: "clips/week1" }));

    expect((await stat(join(root, "clips", "week1"))).isDirectory()).toBe(true);
  });

  it("creates nothing when every link failed", async () => {
    const { services, root } = setup();

    const outcome = await services.downloads.run(
      request({
        urls: ["not a url", "https://vimeo.com/1"],
        outputDir: "clips",
      }),
    );

    expect(outcome.entries).toMatchObject([
      { ok: false, error: { code: "INVALID_URL" } },
      { ok: false, error: { code: "UNSUPPORTED_URL" } },
    ]);
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("forwards progress together with the video it belongs to", async () => {
    const { services } = setup();
    const seen: [string, number][] = [];

    await services.downloads.run(
      request({ onProgress: (ref, percent) => seen.push([ref.id, percent]) }),
    );

    expect(seen).toEqual([
      [A, 50],
      [A, 100],
    ]);
  });

  it("announces the number of videos before the first download starts", async () => {
    const order: string[] = [];
    const { services } = setup({
      overrides: {
        download: async (ref, options) => {
          order.push(`download ${ref.id}`);
          return ok({ ref, filePath: "/f", kind: options.kind, bytes: 1 });
        },
      },
    });

    await services.downloads.run(
      request({
        urls: [PLAYLIST_URL],
        maxItems: 3,
        onPlan: (total) => order.push(`plan ${total}`),
      }),
    );

    expect(order[0]).toBe("plan 3");
  });

  it("caps a playlist at maxItems and reports the truncation", async () => {
    const { services, calls } = setup();

    const outcome = await services.downloads.run(
      request({ urls: [PLAYLIST_URL], maxItems: 2 }),
    );

    expect(calls.download).toHaveLength(2);
    expect(outcome.truncations).toEqual([
      expect.objectContaining({
        source: PLAYLIST_URL,
        total: PLAYLIST_TOTAL,
        included: 2,
      }),
    ]);
  });

  it.each(["../elsewhere", "/etc"])(
    "rejects the output directory %j with OUTPUT_PATH_ESCAPE for every link, starting nothing",
    async (outputDir) => {
      const { services, calls } = setup();

      const outcome = await services.downloads.run(
        request({ urls: [watchUrl(A), PLAYLIST_URL], outputDir }),
      );

      expect(outcome.entries).toMatchObject([
        { url: watchUrl(A), ok: false, error: { code: "OUTPUT_PATH_ESCAPE" } },
        { url: PLAYLIST_URL, ok: false, error: { code: "OUTPUT_PATH_ESCAPE" } },
      ]);
      expect(calls.resolve).toEqual([]);
      expect(calls.download).toEqual([]);
    },
  );

  it("rejects an output directory that leaves the root through a symlink", async () => {
    const { services, root, calls } = setup();
    await mkdir(root, { recursive: true });
    await symlink(temp.path, join(root, "escape"));

    const outcome = await services.downloads.run(
      request({ outputDir: join("escape", "outside") }),
    );

    expect(outcome.entries).toMatchObject([
      { ok: false, error: { code: "OUTPUT_PATH_ESCAPE" } },
    ]);
    expect(calls.download).toEqual([]);
    await expect(stat(join(temp.path, "outside"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("lets one failed download leave the others intact", async () => {
    const { services } = setup({
      overrides: {
        download: async (ref, options) =>
          ref.id === A
            ? err("VIDEO_UNAVAILABLE", "gone")
            : ok({ ref, filePath: "/f", kind: options.kind, bytes: 1 }),
      },
    });

    const outcome = await services.downloads.run(
      request({ urls: [watchUrl(A), watchUrl(B)] }),
    );

    expect(outcome.entries).toMatchObject([
      { ok: false, error: { code: "VIDEO_UNAVAILABLE" } },
      { ok: true },
    ]);
  });

  describe("identical downloads running at the same time", () => {
    const slowDownload = () => {
      const release = Promise.withResolvers<void>();
      const download = vi.fn<Provider["download"]>(async (ref, options) => {
        await release.promise;
        return ok({ ref, filePath: "/f", kind: options.kind, bytes: 1 });
      });
      return { release, download };
    };

    it("share one run of the provider and get the same result", async () => {
      const { release, download } = slowDownload();
      const { services } = setup({ overrides: { download } });

      const both = Promise.all([
        services.downloads.run(request({ outputDir: "clips" })),
        services.downloads.run(request({ outputDir: "clips" })),
      ]);
      await vi.waitFor(() => expect(download).toHaveBeenCalled());
      release.resolve();
      const [first, second] = await both;

      expect(download).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
      expect(first.entries).toMatchObject([{ ok: true }]);
    });

    it("run apart when the quality differs", async () => {
      const { release, download } = slowDownload();
      const { services } = setup({ overrides: { download } });

      const both = Promise.all([
        services.downloads.run(request({ quality: "720p" })),
        services.downloads.run(request({ quality: "480p" })),
      ]);
      await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
      release.resolve();
      await both;

      expect(download).toHaveBeenCalledTimes(2);
    });

    it("run again for the waiting call when the call that started it is cancelled", async () => {
      const started = Promise.withResolvers<void>();
      const download = vi
        .fn<Provider["download"]>()
        .mockImplementationOnce(async (_ref, _options, signal) => {
          started.resolve();
          await new Promise((resolve) =>
            signal?.addEventListener("abort", resolve),
          );
          return err("CANCELLED", "The operation was cancelled");
        })
        .mockImplementation(async (ref, options) =>
          ok({ ref, filePath: "/f", kind: options.kind, bytes: 1 }),
        );
      const { services } = setup({ overrides: { download } });
      const leader = new AbortController();

      const first = services.downloads.run(request(), leader.signal);
      await started.promise;
      const waiting = services.downloads.run(request());
      await new Promise((resolve) => setTimeout(resolve, JOIN_WAIT_MS));
      expect(download).toHaveBeenCalledOnce();
      leader.abort();

      expect((await first).entries).toMatchObject([
        { ok: false, error: { code: "CANCELLED" } },
      ]);
      expect((await waiting).entries).toMatchObject([{ ok: true }]);
      expect(download).toHaveBeenCalledTimes(2);
    });
  });
});
