import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMediaServices } from "../src/composition.js";
import { err } from "../src/domain/result.js";
import type { ProcessRunner } from "../src/infra/process.js";
import { MS_PER_DAY } from "../src/infra/units.js";
import { testConfig } from "./support/config.js";
import { fakeClock } from "./support/fake-clock.js";
import { readFixture } from "./support/fixtures.js";
import { EN, FIRST_ITEM } from "./support/services-fixture.js";
import { withTempDir } from "./support/temp-dir.js";
import { VIDEO_ID, VIDEO_URL, ytDlpFake } from "./support/youtube-fake.js";

const SHORT_LINK = `https://youtu.be/${VIDEO_ID}`;
const THROTTLED_ID = "jNQXAC9IWRw";
const THROTTLED_URL = `https://www.youtube.com/watch?v=${THROTTLED_ID}`;
const DOWNLOAD_ONLY_ID_PREFIX = "dl";
const DOWNLOAD_COUNT = 4;
const DOWNLOAD_POOL = 2;
const THROTTLE_TEXT = "HTTP Error 429";

const infoJson = await readFixture("sintel.info.json");
const captions = await readFixture("sintel.en.json3");

const downloadUrl = (index: number): string =>
  `https://www.youtube.com/watch?v=${DOWNLOAD_ONLY_ID_PREFIX}${String(index).padStart(9, "0")}`;

const isDownload = (args: readonly string[]): boolean =>
  args.includes("--max-filesize");

describe("services never queue or fail behind process limits", () => {
  const temp = withTempDir("media-mcp-isolation-");

  const setup = () => {
    const holdDownloads = Promise.withResolvers<void>();
    const clock = fakeClock();
    const youtube = ytDlpFake({ info: infoJson, captions });
    const started = { downloads: 0 };
    const run: ProcessRunner = async (command, args, options) => {
      if (isDownload(args)) {
        started.downloads += 1;
        await holdDownloads.promise;
        return err("PROCESS_FAILED", "stopped by the test");
      }
      if (args.at(-1) === THROTTLED_URL)
        return err("PROCESS_FAILED", THROTTLE_TEXT);
      return youtube.run(command, args, options);
    };
    const services = createMediaServices(
      {
        ...testConfig,
        cacheDir: join(temp.path, "cache"),
        outputRoot: join(temp.path, "out"),
        // The fake clock also drives the cache, and the back-off sleeps would expire a short TTL.
        transcriptTtlMs: MS_PER_DAY,
      },
      { run, clock: clock.clock, random: () => 0 },
    );
    return { services, started, holdDownloads, calls: youtube.calls };
  };

  it("returns a cached transcript while a download batch fills the download pool", async () => {
    const { services, started, holdDownloads, calls } = setup();
    await services.transcripts.fetch({ urls: [VIDEO_URL], ...EN });
    const processesAfterWarmUp = calls.length;
    const downloads = services.downloads.run({
      urls: Array.from({ length: DOWNLOAD_COUNT }, (_, i) => downloadUrl(i)),
      kind: "video",
      quality: "720p",
      maxItems: DOWNLOAD_COUNT,
      startIndex: FIRST_ITEM,
    });
    await vi.waitFor(() => expect(started.downloads).toBe(DOWNLOAD_POOL));

    const cached = await services.transcripts.fetch({
      urls: [SHORT_LINK],
      ...EN,
    });
    holdDownloads.resolve();
    await downloads;

    expect(cached.entries).toMatchObject([{ ok: true }]);
    expect(calls).toHaveLength(processesAfterWarmUp);
  });

  it("returns a cached transcript while the rate-limit gate fails fast", async () => {
    const { services, calls } = setup();
    await services.transcripts.fetch({ urls: [VIDEO_URL], ...EN });
    const processesAfterWarmUp = calls.length;
    const throttled = await services.info.fetch({
      urls: [THROTTLED_URL],
      maxItems: 1,
      startIndex: FIRST_ITEM,
    });

    const cached = await services.transcripts.fetch({
      urls: [SHORT_LINK],
      ...EN,
    });

    expect(throttled.entries).toMatchObject([
      { ok: false, error: { code: "RATE_LIMITED" } },
    ]);
    expect(cached.entries).toMatchObject([{ ok: true }]);
    expect(calls).toHaveLength(processesAfterWarmUp);
  });
});
