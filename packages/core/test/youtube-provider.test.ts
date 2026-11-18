import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMediaServices } from "../src/composition.js";
import { err } from "../src/domain/result.js";
import { youtubeRef } from "../src/providers/youtube/refs.js";
import { PROCESS_TIMEOUT_MS, testConfig } from "./support/config.js";
import {
  createFakeRunner,
  firstCall,
  type RecordedCall,
  stdoutOf,
  valueAfter,
} from "./support/fake-runner.js";
import { readFixture } from "./support/fixtures.js";
import { FIRST_ITEM } from "./support/services-fixture.js";
import { withTempDir } from "./support/temp-dir.js";
import { unwrap } from "./support/unwrap.js";
import { verified } from "./support/verified-directory.js";
import {
  EN,
  INJECTIONS,
  PLAYLIST_URL,
  provider,
  REF,
  VIDEO_ID,
  VIDEO_URL,
  ytDlpFake,
} from "./support/youtube-fake.js";

const infoJson = await readFixture("sintel.info.json");
const playlistJson = await readFixture("playlist.flat.json");
const manualCaptions = await readFixture("sintel.en.json3");
const autoCaptions = await readFixture("sintel.auto.en.json3");

const infoWith = (changes: object): string =>
  JSON.stringify({ ...JSON.parse(infoJson), ...changes });

const playlistOf = (ids: string[], count?: number): string =>
  JSON.stringify({
    ...(count !== undefined && { playlist_count: count }),
    entries: ids.map((id) => ({ id })),
  });

const expectUrlAfterSeparator = (call: RecordedCall | undefined): void => {
  const args = call?.args ?? [];
  const separator = args.indexOf("--");
  expect(separator).toBe(args.length - 2);
  expect(args[separator + 1]).toMatch(/^https:\/\/www\.youtube\.com\//);
};

describe("createYoutubeProvider getInfo", () => {
  it("maps the recorded yt-dlp JSON including chapters and caption languages", async () => {
    const { run } = ytDlpFake({ info: infoJson });

    const result = await provider(run).getInfo(REF);

    expect(result).toMatchObject({
      ok: true,
      value: {
        ref: REF,
        title: "Sintel - Open Movie by Blender Foundation",
        channel: "Blender",
        durationSeconds: 888,
        description: expect.stringContaining(
          '"Sintel" is an independently produced',
        ),
        chapters: [
          { title: "Introduction", startSeconds: 0 },
          { title: "The quest for the dragon", startSeconds: 93 },
          { title: "The shaman's revelation", startSeconds: 433 },
          { title: "Conclusion and credits", startSeconds: 745 },
        ],
        captionLanguages: {
          manual: expect.arrayContaining(["en", "es", "nl", "pt"]),
          auto: ["en"],
        },
      },
    });
    expect(unwrap(result).captionLanguages.manual).not.toContain(
      "es-3pK74FgVxOs",
    );
  });

  it("omits the duration and channel instead of inventing zero and empty text", async () => {
    const { run } = ytDlpFake({
      info: infoWith({ duration: null, channel: null }),
    });

    const info = unwrap(await provider(run).getInfo(REF));

    expect(info).not.toHaveProperty("durationSeconds");
    expect(info).not.toHaveProperty("channel");
  });

  it("returns an empty chapter list when the video has none", async () => {
    const { run } = ytDlpFake({ info: infoWith({ chapters: null }) });

    const result = await provider(run).getInfo(REF);

    expect(result).toMatchObject({ ok: true, value: { chapters: [] } });
  });

  it("builds the yt-dlp URL from the ref id, never from the ref url", async () => {
    const { run, calls } = ytDlpFake({ info: infoJson });
    const stale = { ...REF, url: "https://example.invalid/anything?x=1" };

    await provider(run).getInfo(stale);

    expect(calls).toHaveLength(1);
    expectUrlAfterSeparator(calls[0]);
    expect(calls[0]?.args.at(-1)).toBe(VIDEO_URL);
  });

  it("runs yt-dlp from config with the config timeout, the signal and the install hint", async () => {
    const { run, calls } = ytDlpFake({ info: infoJson });
    const controller = new AbortController();

    await provider(run, { ...testConfig, ytDlpPath: "/opt/yt-dlp" }).getInfo(
      REF,
      controller.signal,
    );

    expect(firstCall(calls).command).toBe("/opt/yt-dlp");
    expect(firstCall(calls).options).toMatchObject({
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal: controller.signal,
      missingToolHint: expect.stringContaining("brew install yt-dlp"),
    });
  });

  it.each([
    ["not json", "not json"],
    ["json of the wrong shape", '{"id":1}'],
  ])(
    "reports %s from yt-dlp as PARSE_FAILED with a short message",
    async (_label, stdout) => {
      const { run } = createFakeRunner(() => stdoutOf(stdout));

      const result = await provider(run).getInfo(REF);

      expect(result).toMatchObject({
        ok: false,
        error: { code: "PARSE_FAILED" },
      });
      expect(result.ok ? "" : result.error.message).not.toMatch(/[[{]/);
    },
  );

  it("surfaces a missing yt-dlp as TOOL_MISSING with the install hint", async () => {
    const { run } = createFakeRunner(({ options }) =>
      err("TOOL_MISSING", "yt-dlp was not found", options.missingToolHint),
    );

    const result = await provider(run).getInfo(REF);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_MISSING",
        message: "yt-dlp was not found",
        hint: expect.stringContaining("MEDIA_MCP_YTDLP_PATH"),
      },
    });
  });

  it("maps yt-dlp stderr to richer codes", async () => {
    const { run } = createFakeRunner(() =>
      err("PROCESS_FAILED", "[youtube] x: This video is unavailable"),
    );

    const result = await provider(run).getInfo(REF);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VIDEO_UNAVAILABLE" },
    });
  });
});

describe("createYoutubeProvider getTranscript", () => {
  it("returns manual captions when the language has a manual track, even if auto exists too", async () => {
    const { run } = ytDlpFake({ info: infoJson, captions: manualCaptions });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: true,
      value: {
        ref: REF,
        title: "Sintel - Open Movie by Blender Foundation",
        channel: "Blender",
        language: "en",
        source: "manual",
        text: expect.stringMatching(
          /^This blade has a dark past\. It has shed much/,
        ),
      },
    });
  });

  it("omits the channel when yt-dlp reports none", async () => {
    const { run } = ytDlpFake({
      info: infoWith({ channel: null }),
      captions: manualCaptions,
    });

    expect(
      unwrap(await provider(run).getTranscript(REF, EN)),
    ).not.toHaveProperty("channel");
  });

  it("returns the original automatic track when only an automatic one exists", async () => {
    const autoOnly = infoWith({ subtitles: {} });
    const { run } = ytDlpFake({
      info: autoOnly,
      captions: autoCaptions,
    });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: true,
      value: {
        source: "auto",
        text: expect.stringContaining("this blade has a dark past"),
      },
    });
  });

  it("chooses among the written files by the listing, ignoring a translation that was written too", async () => {
    const { run } = createFakeRunner(async ({ options }) => {
      const directory = options.cwd ?? "";
      await writeFile(join(directory, "captions.en.json3"), manualCaptions);
      await writeFile(join(directory, "captions.en-orig.json3"), autoCaptions);
      return stdoutOf(infoWith({ subtitles: {} }));
    });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: true,
      value: {
        source: "auto",
        text: expect.stringContaining("this blade has a dark past it has"),
      },
    });
  });

  it("finds a manual track whose key carries a track id suffix", async () => {
    const { run } = ytDlpFake({
      info: infoJson,
      captions: manualCaptions,
    });

    const result = await provider(run).getTranscript(REF, {
      language: "es",
      timestamps: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { language: "es", source: "manual" },
    });
  });

  it("serves a request for en-orig from the original automatic track", async () => {
    const { run } = ytDlpFake({
      info: infoWith({ subtitles: {} }),
      captions: autoCaptions,
    });

    const result = await provider(run).getTranscript(REF, {
      language: "en-orig",
      timestamps: false,
    });

    expect(result).toMatchObject({ ok: true, value: { source: "auto" } });
  });

  it("does not use a machine translation even when yt-dlp wrote its file", async () => {
    const { run } = ytDlpFake({
      info: infoJson,
      captions: autoCaptions,
    });

    const result = await provider(run).getTranscript(REF, {
      language: "hy",
      timestamps: false,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NO_CAPTIONS" } });
  });

  it("needs nothing beyond the fields the listing prints", async () => {
    const listing = JSON.stringify({
      id: VIDEO_ID,
      title: "Sintel",
      subtitles: { en: [] },
      automatic_captions: {},
    });
    const { run } = ytDlpFake({ info: listing, captions: manualCaptions });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: true,
      value: { title: "Sintel", source: "manual" },
    });
  });

  it("honours the timestamps option", async () => {
    const { run } = ytDlpFake({ info: infoJson, captions: manualCaptions });

    const result = await provider(run).getTranscript(REF, {
      language: "en",
      timestamps: true,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        text: expect.stringMatching(/^\[1:47\] This blade has a dark past\./),
      },
    });
  });

  it("reports NO_CAPTIONS with labelled languages and how to retry", async () => {
    const { run } = ytDlpFake({ info: infoJson, captions: manualCaptions });

    const result = await provider(run).getTranscript(REF, {
      language: "tlh",
      timestamps: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "NO_CAPTIONS",
        message: expect.stringContaining("tlh"),
        hint: expect.stringMatching(
          /^Retry with language set to one of: sq \(manual\), ar \(manual\), bn \(manual\), zh-Hans \(manual\), da \(manual\), nl \(manual\), en \(manual\),/,
        ),
      },
    });
  });

  it("says so when the video has no captions at all", async () => {
    const { run } = ytDlpFake({
      info: infoWith({ subtitles: {}, automatic_captions: {} }),
    });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "NO_CAPTIONS",
        hint: "This video has no manual or automatic captions",
      },
    });
  });

  it("reports NO_CAPTIONS instead of an empty transcript when no text was spoken", async () => {
    const captions = JSON.stringify({
      events: [{ tStartMs: 0, segs: [{ utf8: "\n" }] }],
    });
    const { run } = ytDlpFake({ info: infoJson, captions });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({ ok: false, error: { code: "NO_CAPTIONS" } });
  });

  it("starts exactly one process per uncached transcript, in a private working directory that is gone afterwards", async () => {
    const { run, calls } = ytDlpFake({
      info: infoJson,
      captions: manualCaptions,
    });

    await provider(run).getTranscript(REF, EN);

    const directory = firstCall(calls).options.cwd ?? "";
    expect(calls).toHaveLength(1);
    expect(directory).not.toBe("");
    expectUrlAfterSeparator(firstCall(calls));
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["all", ".*", "en,es"])(
    "reaches yt-dlp with the hostile language %j as anchored literal text and returns NO_CAPTIONS",
    async (language) => {
      const { run, calls } = ytDlpFake({
        info: infoJson,
        captions: manualCaptions,
      });

      const result = await provider(run).getTranscript(REF, {
        language,
        timestamps: false,
      });

      const pattern = valueAfter(firstCall(calls).args, "--sub-langs") ?? "";
      expect(pattern.startsWith("^")).toBe(true);
      expect(pattern).not.toContain(",");
      expect(result).toMatchObject({
        ok: false,
        error: { code: "NO_CAPTIONS" },
      });
    },
  );

  describe("when the caption request fails or leaves the chosen file out", () => {
    const ES_TRACK = "es-3pK74FgVxOs";
    const throttledTrack = (key: string): string =>
      `WARNING: Unable to download video subtitles for '${key}': HTTP Error 429: Too Many Requests`;
    const failing = (code: "RATE_LIMITED" | "CANCELLED") =>
      createFakeRunner(() => err(code, "failed"));

    it("fetches only the chosen track again, without a second listing, when its file is missing", async () => {
      const { run, calls } = createFakeRunner(async ({ args, options }) => {
        if (args.includes("--print"))
          return stdoutOf(infoJson, throttledTrack(ES_TRACK));
        await writeFile(
          join(options.cwd ?? "", `captions.${ES_TRACK}.json3`),
          manualCaptions,
        );
        return stdoutOf("");
      });

      const result = await provider(run).getTranscript(REF, {
        language: "es",
        timestamps: false,
      });

      expect(result).toMatchObject({ ok: true, value: { source: "manual" } });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.args).not.toContain("--print");
      expect(calls[1]?.args).not.toContain("--ignore-errors");
      expect(valueAfter(calls[1]?.args ?? [], "--sub-langs")).toBe(
        `^${ES_TRACK}$`,
      );
    });

    it("answers NO_CAPTIONS when only machine translations exist, even though their downloads failed", async () => {
      const { run, calls } = createFakeRunner(() =>
        stdoutOf(infoJson, throttledTrack("hy")),
      );

      const result = await provider(run).getTranscript(REF, {
        language: "hy",
        timestamps: false,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "NO_CAPTIONS" },
      });
      expect(calls).toHaveLength(2);
    });

    it("keeps a failure of the caption request itself and starts no other process", async () => {
      const { run, calls } = failing("RATE_LIMITED");

      expect(await provider(run).getTranscript(REF, EN)).toMatchObject({
        ok: false,
        error: { code: "RATE_LIMITED" },
      });
      expect(calls).toHaveLength(1);
    });

    it("does not start a second process after a cancellation", async () => {
      const { run, calls } = failing("CANCELLED");

      await provider(run).getTranscript(REF, EN);

      expect(calls).toHaveLength(1);
    });
  });

  it("removes its temporary directory even when parsing fails", async () => {
    const { run, calls } = ytDlpFake({ info: infoJson, captions: "{broken" });

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PARSE_FAILED" },
    });
    const directory = firstCall(calls).options.cwd ?? "";
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a caption file that yt-dlp failed to write, using its stderr", async () => {
    const { run } = createFakeRunner(() =>
      stdoutOf(
        infoJson,
        "WARNING: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests",
      ),
    );

    const result = await provider(run).getTranscript(REF, EN);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });
});

describe("createYoutubeProvider getTranscript cleanup", () => {
  it("returns the transcript even when the temporary directory cannot be removed", async () => {
    const stuckDirectories: string[] = [];
    const { run } = createFakeRunner(async ({ options }) => {
      const directory = options.cwd ?? "";
      const stuck = join(directory, "stuck");
      await mkdir(stuck);
      await writeFile(join(stuck, "file"), "x");
      await chmod(stuck, 0o500);
      stuckDirectories.push(stuck);
      await writeFile(join(directory, "captions.en.json3"), manualCaptions);
      return stdoutOf(infoJson);
    });

    const result = await provider(run).getTranscript(REF, EN);

    for (const stuck of stuckDirectories) {
      await chmod(stuck, 0o700);
      await rm(dirname(stuck), { recursive: true, force: true });
    }
    expect(result).toMatchObject({ ok: true, value: { source: "manual" } });
  });
});

describe("createYoutubeProvider resolve", () => {
  const WINDOW = { maxItems: 2, startIndex: 1 };

  it("caps a playlist at maxItems while reporting the true total", async () => {
    const { run, calls } = ytDlpFake({ playlist: playlistJson });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(result).toEqual({
      ok: true,
      value: {
        total: 93,
        totalExact: true,
        refs: [
          {
            provider: "youtube",
            id: "0P-hQNzDSk8",
            url: "https://www.youtube.com/watch?v=0P-hQNzDSk8",
          },
          {
            provider: "youtube",
            id: "yMc-nxw_2Ew",
            url: "https://www.youtube.com/watch?v=yMc-nxw_2Ew",
          },
        ],
      },
    });
    const args = firstCall(calls).args;
    expect(valueAfter(args, "--playlist-start")).toBe("1");
    expect(valueAfter(args, "--playlist-end")).toBe("3");
    expectUrlAfterSeparator(firstCall(calls));
  });

  it("returns every entry when the playlist is smaller than maxItems", async () => {
    const { run } = ytDlpFake({ playlist: playlistJson });

    const result = await provider(run).resolve(PLAYLIST_URL, {
      maxItems: 50,
      startIndex: 1,
    });

    expect(unwrap(result).refs).toHaveLength(4);
  });

  it("reports a lower bound when the count is unknown and more entries exist", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf(["a", "b", "c"]) });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result)).toMatchObject({ total: 3, totalExact: false });
    expect(unwrap(result).refs.map((ref) => ref.id)).toEqual(["a", "b"]);
  });

  it("reports an exact total when the count is unknown but the playlist ended", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf(["a", "b"]) });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result)).toMatchObject({ total: 2, totalExact: true });
  });

  it("starts at startIndex and counts the skipped entries in the lower bound", async () => {
    const { run, calls } = ytDlpFake({ playlist: playlistOf(["k", "l", "m"]) });

    const result = await provider(run).resolve(PLAYLIST_URL, {
      maxItems: 2,
      startIndex: 11,
    });

    expect(valueAfter(firstCall(calls).args, "--playlist-start")).toBe("11");
    expect(valueAfter(firstCall(calls).args, "--playlist-end")).toBe("13");
    expect(unwrap(result)).toMatchObject({ total: 13, totalExact: false });
  });

  it("keeps the true total from the count when it exceeds what was observed", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf(["a", "b", "c"], 40) });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result)).toMatchObject({ total: 40, totalExact: true });
  });

  it("keeps repeated ids as playlist positions and still detects entries beyond the cap", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf(["a", "a", "b"]) });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result).refs.map((ref) => ref.id)).toEqual(["a", "a"]);
    expect(unwrap(result)).toMatchObject({ total: 3, totalExact: false });
  });

  it("takes the total from the playlist count when yt-dlp knows it", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf(["a", "b", "c"], 2) });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result)).toMatchObject({ total: 2, totalExact: true });
  });

  it("ignores empty entries in the listing", async () => {
    const raw = JSON.stringify({ entries: [null, { id: "a" }] });
    const { run } = ytDlpFake({ playlist: raw });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result).refs.map((ref) => ref.id)).toEqual(["a"]);
  });

  it("reports the real total, not an inflated one, for a window past the end of the playlist", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf([], 93) });

    const result = await provider(run).resolve(PLAYLIST_URL, {
      maxItems: 2,
      startIndex: 100,
    });

    expect(unwrap(result)).toEqual({ refs: [], total: 93, totalExact: true });
  });

  it("reports an empty playlist as empty and exact", async () => {
    const { run } = ytDlpFake({ playlist: playlistOf([]) });

    const result = await provider(run).resolve(PLAYLIST_URL, WINDOW);

    expect(unwrap(result)).toEqual({ refs: [], total: 0, totalExact: true });
  });

  it("resolves a single video, even with a list parameter, without starting a process", async () => {
    const { run, calls } = ytDlpFake({});

    const result = await provider(run).resolve(
      `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLx`,
      WINDOW,
    );

    expect(result).toEqual({
      ok: true,
      value: { refs: [REF], total: 1, totalExact: true },
    });
    expect(calls).toEqual([]);
  });

  it.each(INJECTIONS)("rejects %j before any process starts", async (url) => {
    const { run, calls } = ytDlpFake({ playlist: playlistJson });

    const result = await provider(run).resolve(url, WINDOW);

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_URL" } });
    expect(calls).toEqual([]);
  });
});

describe("a playlist entry whose id is not a video id", () => {
  const temp = withTempDir("media-mcp-entry-");
  const ENTRY = youtubeRef("PLa1F2ddGya_84ye1JAvIGh0Yp7utEKZI_");

  it.each(["getInfo", "getTranscript", "download"] as const)(
    "fails %s with INVALID_URL and starts no process",
    async (operation) => {
      const { run, calls } = ytDlpFake({ info: infoJson });
      const youtube = provider(run);
      const outputDir = await verified(temp.path);

      const result = await {
        getInfo: () => youtube.getInfo(ENTRY),
        getTranscript: () => youtube.getTranscript(ENTRY, EN),
        download: () =>
          youtube.download(ENTRY, {
            kind: "video",
            quality: "best",
            outputDir,
          }),
      }[operation]();

      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_URL" },
      });
      expect(calls).toEqual([]);
    },
  );
});

describe("createYoutubeProvider matches", () => {
  const matcher = provider(ytDlpFake({}).run);

  it("accepts YouTube video and playlist URLs", () => {
    expect(matcher.matches(VIDEO_URL)).toBe(true);
    expect(matcher.matches("https://youtu.be/jNQXAC9IWRw")).toBe(true);
    expect(matcher.matches("https://www.youtube.com/playlist?list=PLx")).toBe(
      true,
    );
  });

  it.each([
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/",
    "https://m.youtube.com/channel/abc",
    "https://music.youtube.com/",
    "https://youtube.com/embed/",
  ])("claims %s so that its own parser can explain what is wrong", (url) => {
    expect(matcher.matches(url)).toBe(true);
  });

  it.each([
    "https://vimeo.com/1",
    "https://evil.example/watch?v=jNQXAC9IWRw",
    "https://notyoutube.com/watch?v=jNQXAC9IWRw",
    "https://www.youtube.com.evil.com/watch",
    "https://www.youtube.com@evil.com/watch",
    "--exec=touch /tmp/x",
  ])("rejects %s by its host", (url) => {
    expect(matcher.matches(url)).toBe(false);
  });
});

describe("a playlist with repeated videos through the services", () => {
  const temp = withTempDir("media-mcp-repeats-");
  const ids = ["Aaaaaaaaaaa", "Aaaaaaaaaaa", "Bbbbbbbbbbb"];

  const infoFor = async (listed: string[], maxItems: number) => {
    const { run } = ytDlpFake({ info: infoJson, playlist: playlistOf(listed) });
    const services = createMediaServices(
      {
        ...testConfig,
        cacheDir: join(temp.path, "cache"),
        outputRoot: temp.path,
      },
      { run },
    );
    return services.info.fetch({
      urls: [PLAYLIST_URL],
      maxItems,
      startIndex: FIRST_ITEM,
    });
  };

  it("reports no truncation when the only repeat is a video already listed", async () => {
    const outcome = await infoFor(ids.slice(0, 2), 5);

    expect(outcome.entries).toHaveLength(1);
    expect(outcome.truncations).toEqual([]);
  });

  it("continues after every position it consumed, repeats included", async () => {
    const outcome = await infoFor(ids, 2);

    expect(outcome.entries).toHaveLength(1);
    expect(outcome.truncations).toEqual([
      {
        source: PLAYLIST_URL,
        total: 3,
        totalExact: false,
        included: 2,
        nextStartIndex: 3,
      },
    ]);
  });
});

describe("link errors through the services with the real YouTube provider", () => {
  const temp = withTempDir("media-mcp-links-");

  const failureOf = async (url: string) => {
    const runner = createFakeRunner(() => stdoutOf(""));
    const services = createMediaServices(
      {
        ...testConfig,
        cacheDir: `${temp.path}/cache`,
        outputRoot: `${temp.path}/out`,
      },
      { run: runner.run },
    );
    const { entries } = await services.info.fetch({
      urls: [url],
      maxItems: 5,
      startIndex: FIRST_ITEM,
    });
    return { entry: entries[0], calls: runner.calls };
  };

  it.each(INJECTIONS)(
    "rejects the non-link %j as INVALID_URL before any provider or process",
    async (url) => {
      const { entry, calls } = await failureOf(url);

      expect(entry).toMatchObject({
        ok: false,
        error: { code: "INVALID_URL" },
      });
      expect(calls).toEqual([]);
    },
  );

  it("rejects a link on a foreign host as UNSUPPORTED_URL without a process", async () => {
    const { entry, calls } = await failureOf("https://vimeo.com/1");

    expect(entry).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_URL",
        hint: expect.stringContaining("youtube"),
      },
    });
    expect(calls).toEqual([]);
  });

  it("passes a malformed YouTube link to the provider for its precise message", async () => {
    const { entry, calls } = await failureOf(
      "https://www.youtube.com/watch?v=short",
    );

    expect(entry).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "The URL does not carry a valid YouTube video id",
      },
    });
    expect(calls).toEqual([]);
  });

  it("reports an unsupported YouTube page with the provider's own hint", async () => {
    const { entry, calls } = await failureOf(
      "https://www.youtube.com/channel/UCabc",
    );

    expect(entry).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_URL",
        message: "Only YouTube video and playlist links are supported",
      },
    });
    expect(calls).toEqual([]);
  });
});
