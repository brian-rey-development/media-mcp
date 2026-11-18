import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMediaServices } from "../src/composition.js";
import { err } from "../src/domain/result.js";
import type { ProcessRunner } from "../src/infra/process.js";
import { testConfig } from "./support/config.js";
import { fakeClock } from "./support/fake-clock.js";
import {
  createFakeProvider,
  videoId,
  watchUrl,
} from "./support/fake-provider.js";
import { createFakeRunner, stdoutOf } from "./support/fake-runner.js";
import { readFixture } from "./support/fixtures.js";
import { EN, FIRST_ITEM } from "./support/services-fixture.js";
import { withTempDir } from "./support/temp-dir.js";
import { VIDEO_URL, ytDlpFake } from "./support/youtube-fake.js";

const OTHER = { name: "other", host: "https://other.example/" };
const OTHER_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IWRw";
const THROTTLE_TEXT = "HTTP Error 429";
const FRENCH_TRACK = "fr-4FRWk5BldbA";
const FAST_CLIENT_ARGS =
  "youtube:skip=dash,hls,translated_subs;player_client=android_vr";
const NO_FORMATS = "WARNING: No video formats found!";
const FORMAT_MISS = "WARNING: Requested format is not available";
const STUB_LISTING = JSON.stringify({
  id: "jNQXAC9IWRw",
  title: "youtube video #jNQXAC9IWRw",
});

// Verbatim from yt-dlp 2026.10.26 extractor/youtube/_video.py, where both come through raise_no_formats(expected=True).
const SESSION_RATE_LIMITED = `This content isn't available, try again later. The current session has been rate-limited by YouTube for up to an hour. It is recommended to use \`-t sleep\` to add a delay between video requests to avoid exceeding the rate limit. For more information, refer to  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#this-content-isnt-available-try-again-later`;
const CAPTCHA_WALL =
  "Video unavailable. YouTube is requiring a captcha challenge before playback";

const infoJson = await readFixture("sintel.info.json");
const captions = await readFixture("sintel.en.json3");

const subtitleFailure = (key: string): string =>
  `Unable to download video subtitles for '${key}': ${THROTTLE_TEXT}: Too Many Requests`;

const isCaptionRequest = (args: readonly string[]): boolean =>
  args.includes("--print") && args.includes("--skip-download");

// yt-dlp 2026.10.26 fails a subtitle download with exit 1, or only warns and exits 0 under --ignore-errors.
const subtitleOutcome = (args: readonly string[], key: string) =>
  args.includes("--ignore-errors")
    ? stdoutOf(infoJson, `WARNING: ${subtitleFailure(key)}`)
    : err("PROCESS_FAILED", subtitleFailure(key));

const throttledTranslation: ProcessRunner = async (_command, args, options) => {
  if (!isCaptionRequest(args)) return stdoutOf(infoJson);
  const file = join(options.cwd ?? "", `captions.${FRENCH_TRACK}.json3`);
  await writeFile(file, captions);
  return subtitleOutcome(args, "fr");
};

const throttledChosenTrack: ProcessRunner = async (_command, args) => {
  if (isCaptionRequest(args)) return subtitleOutcome(args, FRENCH_TRACK);
  if (args.includes("--write-subs")) return subtitleOutcome(args, FRENCH_TRACK);
  return stdoutOf(infoJson);
};

describe("createMediaServices", () => {
  const temp = withTempDir("media-mcp-composition-");
  const configOf = () => ({
    ...testConfig,
    cacheDir: join(temp.path, "cache"),
    outputRoot: join(temp.path, "out"),
  });
  const throttledServices = (run: ProcessRunner) => {
    const runner = createFakeRunner((call) =>
      run(call.command, call.args, call.options),
    );
    const services = createMediaServices(configOf(), {
      run: runner.run,
      clock: fakeClock().clock,
      random: () => 0,
    });
    const info = (url: string) =>
      services.info.fetch({ urls: [url], maxItems: 1, startIndex: FIRST_ITEM });
    return { services, info, calls: runner.calls };
  };

  it("serves YouTube and every extra provider through one set of services", async () => {
    const youtube = ytDlpFake({ info: infoJson, captions });
    const fake = createFakeProvider();
    const other = createFakeProvider({}, OTHER);
    const services = createMediaServices(configOf(), {
      run: youtube.run,
      providers: [fake.provider, other.provider],
    });

    const outcome = await services.transcripts.fetch({
      ...EN,
      urls: [VIDEO_URL, watchUrl(videoId(1)), watchUrl(videoId(2), OTHER)],
    });

    expect(
      outcome.entries.map((entry) => entry.ok && entry.value.ref.provider),
    ).toEqual(["youtube", "fake", "other"]);
    expect(youtube.calls).toHaveLength(1);
    expect(fake.calls.transcript).toHaveLength(1);
    expect(other.calls.transcript).toHaveLength(1);
  });

  it("fails fast with RATE_LIMITED once yt-dlp is being throttled", async () => {
    const { info, calls } = throttledServices(async () =>
      err("PROCESS_FAILED", THROTTLE_TEXT),
    );

    const first = await info(VIDEO_URL);
    const startedAfterFirst = calls.length;
    const second = await info(OTHER_VIDEO_URL);

    expect(first.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(startedAfterFirst).toBe(2);
    expect(second.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(calls).toHaveLength(startedAfterFirst);
  });

  it("returns the manual track when a machine translation is throttled, and leaves the gate open", async () => {
    const { services, info, calls } = throttledServices(throttledTranslation);

    const transcript = await services.transcripts.fetch({
      ...EN,
      language: "fr",
      urls: [VIDEO_URL],
    });
    const startedAfterTranscript = calls.length;
    const next = await info(OTHER_VIDEO_URL);

    expect(transcript.entries).toMatchObject([
      { ok: true, value: { language: "fr", source: "manual" } },
    ]);
    expect(startedAfterTranscript).toBe(1);
    expect(next.entries).toMatchObject([{ ok: true }]);
    expect(calls).toHaveLength(startedAfterTranscript + 1);
  });

  it("reports a throttled chosen track as RATE_LIMITED and closes the gate", async () => {
    const { services, info, calls } = throttledServices(throttledChosenTrack);

    const transcript = await services.transcripts.fetch({
      ...EN,
      language: "fr",
      urls: [VIDEO_URL],
    });
    const startedAfterTranscript = calls.length;
    const next = await info(OTHER_VIDEO_URL);

    expect(transcript.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(startedAfterTranscript).toBe(3);
    expect(next.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(calls).toHaveLength(startedAfterTranscript);
  });

  it("reports a video the client cannot play as VIDEO_UNAVAILABLE instead of its stub listing", async () => {
    const { info } = throttledServices(async () =>
      stdoutOf(
        STUB_LISTING,
        `WARNING: [youtube] This video is unavailable\n${NO_FORMATS}\n${FORMAT_MISS}`,
      ),
    );

    expect((await info(OTHER_VIDEO_URL)).entries).toMatchObject([
      {
        ok: false,
        error: {
          code: "VIDEO_UNAVAILABLE",
          message: "[youtube] This video is unavailable",
        },
      },
    ]);
  });

  it("still closes the gate on a bot check that arrives as a warning", async () => {
    const botCheck = `WARNING: [youtube] ${videoId(1)}: Sign in to confirm you're not a bot`;
    const { info, calls } = throttledServices(async () =>
      stdoutOf(STUB_LISTING, `${botCheck}\n${NO_FORMATS}`),
    );

    const first = await info(VIDEO_URL);
    const startedAfterFirst = calls.length;
    const second = await info(OTHER_VIDEO_URL);

    expect(first.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(second.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(calls).toHaveLength(startedAfterFirst);
  });

  it.each([
    ["a rate-limited session", SESSION_RATE_LIMITED],
    ["a captcha wall", CAPTCHA_WALL],
  ])(
    "ends a transcript behind %s as RATE_LIMITED without a second client, and fails the next call fast",
    async (_name, reason) => {
      const { services, info, calls } = throttledServices(async () =>
        stdoutOf(
          STUB_LISTING,
          `WARNING: [youtube] ${videoId(1)}: ${reason}\n${NO_FORMATS}`,
        ),
      );

      const transcript = await services.transcripts.fetch({
        ...EN,
        urls: [VIDEO_URL],
      });
      const startedAfterTranscript = calls.length;
      const next = await info(OTHER_VIDEO_URL);

      expect(transcript.entries).toMatchObject([
        { ok: false, error: { code: "RATE_LIMITED" } },
      ]);
      expect(startedAfterTranscript).toBe(2);
      expect(calls.every((call) => call.args.includes(FAST_CLIENT_ARGS))).toBe(
        true,
      );
      expect(next.entries).toMatchObject([
        { ok: false, error: { code: "RATE_LIMITED" } },
      ]);
      expect(calls).toHaveLength(startedAfterTranscript);
    },
  );

  it("starts at most six processes for one transcript, even when every request is throttled once first", async () => {
    const outcomes = [
      err("PROCESS_FAILED", THROTTLE_TEXT),
      stdoutOf(infoJson),
      err("PROCESS_FAILED", THROTTLE_TEXT),
      stdoutOf(infoJson),
      err("PROCESS_FAILED", THROTTLE_TEXT),
      err("PROCESS_FAILED", "boom"),
    ];
    const { services, calls } = throttledServices(
      async () => outcomes[calls.length - 1] ?? err("PROCESS_FAILED", "extra"),
    );

    const transcript = await services.transcripts.fetch({
      ...EN,
      urls: [VIDEO_URL],
    });

    expect(transcript.entries).toMatchObject([
      { ok: false, error: { code: "PROCESS_FAILED", message: "boom" } },
    ]);
    expect(calls).toHaveLength(outcomes.length);
  });

  it("keeps the info of a playable video whose only problem was the format selection", async () => {
    const { info } = throttledServices(async () =>
      stdoutOf(infoJson, `WARNING: [youtube] PO token note\n${FORMAT_MISS}`),
    );

    expect((await info(OTHER_VIDEO_URL)).entries).toMatchObject([
      {
        ok: true,
        value: { title: "Sintel - Open Movie by Blender Foundation" },
      },
    ]);
  });
});
