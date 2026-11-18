import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../src/domain/result.js";
import { MS_PER_MINUTE } from "../src/infra/units.js";
import type { Provider } from "../src/providers/provider.js";
import { fakeClock } from "./support/fake-clock.js";
import {
  embedUrl,
  PLAYLIST_TOTAL,
  PLAYLIST_URL,
  SECOND_PLAYLIST_URL,
  shortUrl,
  videoId,
  watchUrl,
} from "./support/fake-provider.js";
import { FIRST_ITEM, servicesFixture } from "./support/services-fixture.js";

const A = videoId(1);
const B = videoId(2);
const FIVE_MINUTES_MS = 5 * MS_PER_MINUTE;
const LONG_LINK_LENGTH = 100_000;
const MAX_MESSAGE_LENGTH = 400;
const MESSAGE_PATTERN = new RegExp(`^.{1,${MAX_MESSAGE_LENGTH}}$`, "s");

const urlsOf = (entries: readonly { url: string }[]): string[] =>
  entries.map((entry) => entry.url);

describe("URL expansion", () => {
  const { setup } = servicesFixture();
  const infoOf = (
    services: ReturnType<typeof setup>["services"],
    urls: string[],
    maxItems = 50,
    startIndex = FIRST_ITEM,
  ) => services.info.fetch({ urls, maxItems, startIndex });

  it("expands a playlist up to maxItems and reports the real total once", async () => {
    const { services } = setup();

    const outcome = await infoOf(services, [PLAYLIST_URL], 3);

    expect(urlsOf(outcome.entries)).toEqual([
      watchUrl(videoId(0)),
      watchUrl(videoId(1)),
      watchUrl(videoId(2)),
    ]);
    expect(outcome.entries.every((entry) => entry.ok)).toBe(true);
    expect(outcome.truncations).toEqual([
      {
        source: PLAYLIST_URL,
        total: PLAYLIST_TOTAL,
        totalExact: true,
        included: 3,
        nextStartIndex: 4,
      },
    ]);
  });

  it("reports no truncation when the playlist fits under maxItems", async () => {
    const { services } = setup();

    const outcome = await infoOf(services, [PLAYLIST_URL], PLAYLIST_TOTAL);

    expect(outcome.entries).toHaveLength(PLAYLIST_TOTAL);
    expect(outcome.truncations).toEqual([]);
  });

  it("starts a playlist at startIndex and says where to continue", async () => {
    const { services } = setup();

    const outcome = await infoOf(services, [PLAYLIST_URL], 3, 5);

    expect(urlsOf(outcome.entries)).toEqual([
      watchUrl(videoId(4)),
      watchUrl(videoId(5)),
      watchUrl(videoId(6)),
    ]);
    expect(outcome.truncations).toMatchObject([
      { included: 3, total: PLAYLIST_TOTAL, nextStartIndex: 8 },
    ]);
  });

  it("reports no truncation when the rest of the playlist fits from startIndex", async () => {
    const { services } = setup();

    const outcome = await infoOf(services, [PLAYLIST_URL], 50, 10);

    expect(outcome.entries).toHaveLength(PLAYLIST_TOTAL - 9);
    expect(outcome.truncations).toEqual([]);
  });

  it("passes on a total that is only a lower bound", async () => {
    const { services } = setup({
      overrides: {
        resolve: async () =>
          ok({
            refs: [
              { provider: "fake", id: A, url: watchUrl(A) },
              { provider: "fake", id: B, url: watchUrl(B) },
            ],
            total: 7,
            totalExact: false,
          }),
      },
    });

    const outcome = await infoOf(services, [PLAYLIST_URL], 50);

    expect(outcome.truncations).toMatchObject([
      { total: 7, totalExact: false, included: 2, nextStartIndex: 3 },
    ]);
  });

  it("reports a window past the end of a playlist with its real total and no videos", async () => {
    const { services } = setup();

    const outcome = await infoOf(services, [PLAYLIST_URL], 5, 100);

    expect(outcome.entries).toEqual([]);
    expect(outcome.truncations).toEqual([
      {
        source: PLAYLIST_URL,
        total: PLAYLIST_TOTAL,
        totalExact: true,
        included: 0,
      },
    ]);
  });

  it("reports an empty playlist with a total of zero", async () => {
    const { services } = setup({
      overrides: {
        resolve: async () => ok({ refs: [], total: 0, totalExact: true }),
      },
    });

    const outcome = await infoOf(services, [PLAYLIST_URL], 5);

    expect(outcome.entries).toEqual([]);
    expect(outcome.truncations).toEqual([
      { source: PLAYLIST_URL, total: 0, totalExact: true, included: 0 },
    ]);
  });

  it.each([
    ["a non-link", "x"],
    ["a foreign link", "https://vimeo.com/"],
  ])(
    "cuts %s in the error message to a short excerpt",
    async (_name, prefix) => {
      const { services } = setup();
      const long = `${prefix}${"a".repeat(LONG_LINK_LENGTH)}`;

      const [entry] = (await infoOf(services, [long])).entries;

      expect(entry).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(MESSAGE_PATTERN) },
      });
    },
  );

  it("turns a bad URL into a failed entry while the others succeed", async () => {
    const { services } = setup();

    const outcome = await infoOf(services, [
      "not a url",
      watchUrl(A),
      "https://vimeo.com/1",
    ]);

    expect(outcome.entries).toMatchObject([
      { url: "not a url", ok: false, error: { code: "INVALID_URL" } },
      { url: watchUrl(A), ok: true },
      {
        url: "https://vimeo.com/1",
        ok: false,
        error: { code: "UNSUPPORTED_URL" },
      },
    ]);
  });

  it("names the supported sources when no provider matches", async () => {
    const { services } = setup();

    const [entry] = (await infoOf(services, ["https://vimeo.com/1"])).entries;

    expect(entry).toMatchObject({
      ok: false,
      error: { hint: expect.stringContaining("fake") },
    });
  });

  it("fetches the same video once and reports it once across link forms", async () => {
    const { services, calls } = setup();

    const outcome = await infoOf(services, [
      watchUrl(A),
      shortUrl(A),
      embedUrl(A),
    ]);

    expect(outcome.entries).toHaveLength(1);
    expect(outcome.entries[0]).toMatchObject({ url: watchUrl(A), ok: true });
    expect(calls.info).toHaveLength(1);
  });

  it("keeps the link the caller passed next to the canonical one", async () => {
    const { services } = setup();
    const short = shortUrl(A);

    const outcome = await infoOf(
      services,
      [short, "not a url", PLAYLIST_URL],
      3,
    );

    expect(outcome.entries.map(({ url, inputUrl }) => [url, inputUrl])).toEqual(
      [
        [watchUrl(A), short],
        ["not a url", "not a url"],
        [watchUrl(videoId(0)), PLAYLIST_URL],
        [watchUrl(videoId(2)), PLAYLIST_URL],
      ],
    );
  });

  it("lists a video once when a playlist and a direct link both carry it", async () => {
    const { services, calls } = setup();

    const outcome = await infoOf(
      services,
      [watchUrl(videoId(1)), PLAYLIST_URL],
      3,
    );

    expect(urlsOf(outcome.entries)).toEqual([
      watchUrl(videoId(1)),
      watchUrl(videoId(0)),
      watchUrl(videoId(2)),
    ]);
    expect(calls.info).toHaveLength(3);
  });

  it("caps the whole call at maxItems and leaves later sources unresolved", async () => {
    const { services, calls } = setup();

    const outcome = await infoOf(
      services,
      [PLAYLIST_URL, SECOND_PLAYLIST_URL],
      8,
    );

    expect(urlsOf(outcome.entries)).toEqual(
      Array.from({ length: 8 }, (_, index) => watchUrl(videoId(index))),
    );
    expect(calls.info).toHaveLength(8);
    expect(calls.resolve).toEqual([PLAYLIST_URL]);
    expect(outcome.truncations).toEqual([
      expect.objectContaining({
        source: PLAYLIST_URL,
        total: PLAYLIST_TOTAL,
        included: 8,
      }),
      { source: SECOND_PLAYLIST_URL, included: 0, totalExact: false },
    ]);
  });

  it("spends the shared cap on single links first when they come first", async () => {
    const { services } = setup();

    const outcome = await infoOf(
      services,
      [watchUrl(videoId(50)), PLAYLIST_URL, watchUrl(videoId(51))],
      4,
    );

    expect(urlsOf(outcome.entries)).toEqual([
      watchUrl(videoId(50)),
      watchUrl(videoId(0)),
      watchUrl(videoId(1)),
      watchUrl(videoId(2)),
    ]);
    expect(outcome.truncations).toEqual([
      expect.objectContaining({ source: PLAYLIST_URL, included: 3 }),
      { source: watchUrl(videoId(51)), included: 0, totalExact: false },
    ]);
  });

  it("does not truncate when single links and a playlist together fit", async () => {
    const { services } = setup();

    const outcome = await infoOf(
      services,
      [watchUrl(videoId(50)), PLAYLIST_URL],
      PLAYLIST_TOTAL + 1,
    );

    expect(outcome.entries).toHaveLength(PLAYLIST_TOTAL + 1);
    expect(outcome.truncations).toEqual([]);
  });

  it("keeps failed entries out of the cap, even after the cap is reached", async () => {
    const { services } = setup();

    const outcome = await infoOf(
      services,
      [watchUrl(A), "not a url", watchUrl(B)],
      1,
    );

    expect(outcome.entries).toMatchObject([
      { ok: true },
      { url: "not a url", ok: false, error: { code: "INVALID_URL" } },
    ]);
    expect(outcome.truncations).toEqual([
      { source: watchUrl(B), included: 0, totalExact: false },
    ]);
  });

  it("resolves an identical link given twice only once", async () => {
    const { services, calls } = setup();

    await infoOf(services, [PLAYLIST_URL, PLAYLIST_URL], 2);

    expect(calls.resolve).toEqual([PLAYLIST_URL]);
  });

  describe("remembering playlist resolutions", () => {
    it("resolves a playlist once for repeated calls with the same window", async () => {
      const { services, calls } = setup();

      await infoOf(services, [PLAYLIST_URL], 3);
      await infoOf(services, [PLAYLIST_URL], 3);

      expect(calls.resolve).toHaveLength(1);
    });

    it("keys the memory by window, so another startIndex or maxItems resolves again", async () => {
      const { services, calls } = setup();

      await infoOf(services, [PLAYLIST_URL], 3);
      await infoOf(services, [PLAYLIST_URL], 3, 4);
      await infoOf(services, [PLAYLIST_URL], 4);

      expect(calls.resolve).toHaveLength(3);
    });

    it("forgets a resolution after a few minutes", async () => {
      const { clock, state } = fakeClock();
      const { services, calls } = setup({ deps: { clock } });

      await infoOf(services, [PLAYLIST_URL], 3);
      state.time = FIVE_MINUTES_MS + 1;
      await infoOf(services, [PLAYLIST_URL], 3);

      expect(calls.resolve).toHaveLength(2);
    });

    it("never remembers a failed resolution", async () => {
      const resolve = vi.fn<Provider["resolve"]>(async () =>
        err("PROCESS_FAILED", "boom"),
      );
      const { services } = setup({ overrides: { resolve } });

      await infoOf(services, [PLAYLIST_URL], 3);
      await infoOf(services, [PLAYLIST_URL], 3);

      expect(resolve).toHaveBeenCalledTimes(2);
    });
  });
});
