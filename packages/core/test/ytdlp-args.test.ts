import { describe, expect, it } from "vitest";
import type { ErrorCode } from "../src/domain/errors.js";
import { err } from "../src/domain/result.js";
import { checkYtDlp } from "../src/providers/ytdlp/preflight.js";
import { testConfig } from "./support/config.js";
import {
  createFakeRunner,
  type RecordedCall,
  stdoutOf,
  valueAfter,
} from "./support/fake-runner.js";
import { readFixture } from "./support/fixtures.js";
import { withTempDir } from "./support/temp-dir.js";
import { verified } from "./support/verified-directory.js";
import {
  EN,
  PLAYLIST_URL,
  provider,
  REF,
  ytDlpFake,
} from "./support/youtube-fake.js";

const FAST_CLIENT = "player_client=android_vr";
const STANDARD_EXTRACTOR_ARGS = "youtube:skip=dash,hls,translated_subs";
const infoJson = await readFixture("sintel.info.json");
const playlistJson = await readFixture("playlist.flat.json");
const manualCaptions = await readFixture("sintel.en.json3");

const isFast = ({ args }: RecordedCall): boolean =>
  valueAfter(args, "--extractor-args")?.includes(FAST_CLIENT) ?? false;

describe("every yt-dlp call", () => {
  const temp = withTempDir("media-mcp-args-");

  const everyCall = async (): Promise<RecordedCall[]> => {
    const { run, calls } = ytDlpFake({
      info: infoJson,
      playlist: playlistJson,
      captions: manualCaptions,
    });
    const youtube = provider(run);
    await youtube.getInfo(REF);
    await youtube.getTranscript(REF, EN);
    await youtube.resolve(PLAYLIST_URL, { maxItems: 3, startIndex: 1 });
    await youtube.download(REF, {
      kind: "video",
      quality: "best",
      outputDir: await verified(temp.path),
    });
    await checkYtDlp(run, testConfig);
    return calls;
  };

  it("ignores user config files and plugins", async () => {
    for (const { args } of await everyCall()) {
      expect(args.slice(0, 2)).toEqual(["--ignore-config", "--no-plugin-dirs"]);
    }
  });

  it("hands yt-dlp the Node.js that runs this server", async () => {
    for (const { args } of await everyCall()) {
      expect(valueAfter(args, "--js-runtimes")).toBe(
        `node:${process.execPath}`,
      );
    }
  });

  it("puts the URL last, directly after a -- separator", async () => {
    const withUrl = (await everyCall()).filter(
      ({ args }) => !args.includes("--version"),
    );

    expect(withUrl).toHaveLength(4);
    for (const { args } of withUrl) {
      expect(args.slice(-2)).toEqual(["--", expect.stringMatching(/^https:/)]);
    }
  });
});

describe("what each call asks yt-dlp to print", () => {
  const fieldsOf = (template: string | undefined): string[] =>
    /^%\(\.\{(.+)\}\)j$/.exec(template ?? "")?.[1]?.split(",") ?? [];

  it("limits the info call to the fields of the recorded output instead of dumping everything", async () => {
    const { run, calls } = ytDlpFake({ info: infoJson });

    await provider(run).getInfo(REF);

    const [call] = calls;
    expect(call?.args).not.toContain("--dump-single-json");
    expect(fieldsOf(valueAfter(call?.args ?? [], "--print")).sort()).toEqual(
      Object.keys(JSON.parse(infoJson)).sort(),
    );
  });

  it("limits the caption listing to fields the recorded output has", async () => {
    const { run, calls } = ytDlpFake({ info: infoJson, captions: "{}" });

    await provider(run).getTranscript(REF, EN);

    const fields = fieldsOf(valueAfter(calls[0]?.args ?? [], "--print"));
    expect(fields).toEqual(
      expect.arrayContaining(["title", "subtitles", "automatic_captions"]),
    );
    for (const field of fields)
      expect(JSON.parse(infoJson)).toHaveProperty(field);
  });

  it("flattens a playlist and fetches one entry beyond the cap to detect more", async () => {
    const { run, calls } = ytDlpFake({ playlist: playlistJson });

    await provider(run).resolve(PLAYLIST_URL, { maxItems: 7, startIndex: 11 });

    const args = calls[0]?.args ?? [];
    expect(args).toContain("--flat-playlist");
    expect(valueAfter(args, "--playlist-start")).toBe("11");
    expect(valueAfter(args, "--playlist-end")).toBe("18");
  });
});

describe("the caption request", () => {
  it("lists and writes the candidate tracks as json3 in one call, into a fixed relative name", async () => {
    const { run, calls } = ytDlpFake({
      info: infoJson,
      captions: manualCaptions,
    });

    await provider(run).getTranscript(REF, EN);

    const args = calls[0]?.args ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--no-simulate",
        "--ignore-errors",
      ]),
    );
    expect(valueAfter(args, "--sub-format")).toBe("json3");
    expect(valueAfter(args, "-o")).toBe("captions");
  });
});

describe("format selection on metadata calls", () => {
  const temp = withTempDir("media-mcp-formats-");

  it("lets every metadata call survive a format the client cannot offer, and no download", async () => {
    const { run, calls } = ytDlpFake({
      info: infoJson,
      playlist: playlistJson,
      captions: manualCaptions,
    });
    const youtube = provider(run);
    await youtube.getInfo(REF);
    await youtube.getTranscript(REF, EN);
    await youtube.resolve(PLAYLIST_URL, { maxItems: 3, startIndex: 1 });
    await youtube.download(REF, {
      kind: "video",
      quality: "best",
      outputDir: await verified(temp.path),
    });

    expect(
      calls.map(({ args }) => args.includes("--ignore-no-formats-error")),
    ).toEqual([true, true, true, false]);
  });

  it("returns the info instead of TOOL_OUTDATED when only the format selection missed", async () => {
    const { run } = createFakeRunner(() =>
      stdoutOf(infoJson, "WARNING: Requested format is not available"),
    );

    expect(await provider(run).getInfo(REF)).toMatchObject({ ok: true });
  });
});

describe("client profiles", () => {
  const info = (run: Parameters<typeof provider>[0]) =>
    provider(run).getInfo(REF);
  const transcript = (run: Parameters<typeof provider>[0]) =>
    provider(run).getTranscript(REF, EN);

  it.each([
    ["info", info],
    ["transcript", transcript],
  ])(
    "%s tries the fast client first and needs one process when it works",
    async (_label, fetch) => {
      const { run, calls } = ytDlpFake({
        info: infoJson,
        captions: manualCaptions,
      });

      const result = await fetch(run);

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(valueAfter(calls[0]?.args ?? [], "--extractor-args")).toBe(
        `${STANDARD_EXTRACTOR_ARGS};${FAST_CLIENT}`,
      );
    },
  );

  it("retries info once with the standard client when the fast client fails", async () => {
    const { run, calls } = createFakeRunner((call) =>
      isFast(call) ? err("PROCESS_FAILED", "boom") : stdoutOf(infoJson),
    );

    const result = await info(run);

    expect(result).toMatchObject({
      ok: true,
      value: { title: "Sintel - Open Movie by Blender Foundation" },
    });
    expect(calls.map(isFast)).toEqual([true, false]);
    expect(valueAfter(calls[1]?.args ?? [], "--extractor-args")).toBe(
      STANDARD_EXTRACTOR_ARGS,
    );
  });

  it("retries a transcript with the standard client when the fast client returns unreadable output", async () => {
    const fallback = ytDlpFake({ info: infoJson, captions: manualCaptions });
    const { run, calls } = createFakeRunner((call) =>
      isFast(call)
        ? stdoutOf("not json")
        : fallback.run(call.command, call.args, call.options),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({ ok: true, value: { source: "manual" } });
    expect(calls.map(isFast)).toEqual([true, false]);
  });

  it("retries a transcript with the standard client when the fast caption request fails", async () => {
    const fallback = ytDlpFake({ info: infoJson, captions: manualCaptions });
    const { run, calls } = createFakeRunner((call) =>
      isFast(call)
        ? err("PROCESS_FAILED", "boom")
        : fallback.run(call.command, call.args, call.options),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({ ok: true, value: { source: "manual" } });
    expect(calls.map(isFast)).toEqual([true, false]);
  });

  it("retries a transcript with the standard client when the fast client finds no captions", async () => {
    const fallback = ytDlpFake({ info: infoJson, captions: manualCaptions });
    const noCaptions = JSON.stringify({
      ...JSON.parse(infoJson),
      subtitles: {},
      automatic_captions: {},
    });
    const { run, calls } = createFakeRunner((call) =>
      isFast(call)
        ? stdoutOf(noCaptions)
        : fallback.run(call.command, call.args, call.options),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({ ok: true, value: { source: "manual" } });
    expect(calls.map(isFast)).toEqual([true, false]);
  });

  it.each([
    "VIDEO_UNAVAILABLE",
    "RATE_LIMITED",
    "TIMEOUT",
    "CANCELLED",
    "TOOL_MISSING",
    "TOOL_OUTDATED",
  ] as const satisfies readonly ErrorCode[])(
    "does not retry info after %s",
    async (code) => {
      const { run, calls } = createFakeRunner(() => err(code, "failed"));

      const result = await info(run);

      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(calls).toHaveLength(1);
    },
  );

  it("does not retry a transcript for an unavailable video", async () => {
    const { run, calls } = createFakeRunner(() =>
      err("VIDEO_UNAVAILABLE", "failed"),
    );

    await transcript(run);

    expect(calls).toHaveLength(1);
  });

  it("uses the standard client alone for playlists", async () => {
    const { run, calls } = ytDlpFake({ playlist: playlistJson });

    await provider(run).resolve(PLAYLIST_URL, { maxItems: 3, startIndex: 1 });

    expect(valueAfter(calls[0]?.args ?? [], "--extractor-args")).toBe(
      STANDARD_EXTRACTOR_ARGS,
    );
  });
});

describe("the process budget of one transcript", () => {
  const transcript = (run: Parameters<typeof provider>[0], language = "en") =>
    provider(run).getTranscript(REF, { language, timestamps: false });
  const listingWith = (changes: object): string =>
    JSON.stringify({ ...JSON.parse(infoJson), ...changes });
  const THROTTLED_EN =
    "WARNING: Unable to download video subtitles for 'en': HTTP Error 429";

  it("starts two processes, not six, when the caption request fails on both clients", async () => {
    const { run, calls } = createFakeRunner(() =>
      err("PROCESS_FAILED", "boom"),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROCESS_FAILED" },
    });
    expect(calls.map(isFast)).toEqual([true, false]);
  });

  it("fetches a missing chosen file alone only on the standard client when the fast one falls back", async () => {
    const { run, calls } = createFakeRunner(() => stdoutOf(infoJson));

    const result = await transcript(run);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROCESS_FAILED" },
    });
    expect(calls.map(isFast)).toEqual([true, false, false]);
    expect(calls[2]?.args).not.toContain("--print");
  });

  it("ends on the fast client when the track retry already ran there, instead of listing again on the standard client", async () => {
    const { run, calls } = createFakeRunner(({ args }) =>
      args.includes("--print")
        ? stdoutOf(infoJson, THROTTLED_EN)
        : err("PROCESS_FAILED", "boom"),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROCESS_FAILED", message: "boom" },
    });
    expect(calls.map(isFast)).toEqual([true, true]);
  });

  it("keeps the fast NO_CAPTIONS answer when the standard client then fails otherwise", async () => {
    const none = listingWith({ subtitles: {}, automatic_captions: {} });
    const { run, calls } = createFakeRunner((call) =>
      isFast(call) ? stdoutOf(none) : err("TIMEOUT", "timed out"),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "NO_CAPTIONS",
        hint: "This video has no manual or automatic captions",
      },
    });
    expect(calls).toHaveLength(2);
  });

  it("reports the throttle when the standard client is rate limited after the fast NO_CAPTIONS", async () => {
    const none = listingWith({ subtitles: {}, automatic_captions: {} });
    const { run, calls } = createFakeRunner((call) =>
      isFast(call) ? stdoutOf(none) : err("RATE_LIMITED", "HTTP Error 429"),
    );

    const result = await transcript(run);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
    expect(calls).toHaveLength(2);
  });

  it("reports the cancellation when the standard client is cancelled after the fast NO_CAPTIONS", async () => {
    const none = listingWith({ subtitles: {}, automatic_captions: {} });
    const { run } = createFakeRunner((call) =>
      isFast(call)
        ? stdoutOf(none)
        : err("CANCELLED", "The operation was cancelled"),
    );

    expect(await transcript(run)).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
  });

  it("returns the standard NO_CAPTIONS answer when both clients find none", async () => {
    const none = listingWith({ subtitles: {}, automatic_captions: {} });
    const englishOnly = listingWith({
      subtitles: { en: [] },
      automatic_captions: {},
    });
    const { run } = createFakeRunner((call) =>
      stdoutOf(isFast(call) ? none : englishOnly),
    );

    expect(await transcript(run, "fr")).toMatchObject({
      ok: false,
      error: {
        code: "NO_CAPTIONS",
        hint: "Retry with language set to one of: en (manual)",
      },
    });
  });
});

describe("downloads", () => {
  const temp = withTempDir("media-mcp-dl-args-");

  it("never carry extractor arguments, so no stream a merge needs is skipped", async () => {
    const { run, calls } = ytDlpFake({});

    await provider(run).download(REF, {
      kind: "video",
      quality: "best",
      outputDir: await verified(temp.path),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).not.toContain("--extractor-args");
    expect(calls[0]?.args.join(" ")).not.toContain("player_client");
  });
});
