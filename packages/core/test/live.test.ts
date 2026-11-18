import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createMediaServices } from "../src/composition.js";
import { loadConfig } from "../src/infra/config.js";
import { type ProcessRunner, runProcess } from "../src/infra/process.js";
import { EN, FIRST_ITEM } from "./support/services-fixture.js";
import { withTempDir } from "./support/temp-dir.js";
import { unwrap } from "./support/unwrap.js";

const SINTEL_URL = "https://www.youtube.com/watch?v=eRsGyueVLvQ";
const BIG_BUCK_BUNNY_URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
const UNAVAILABLE_URL = "https://www.youtube.com/watch?v=jNQXAC9IWRw";
const MANUAL_TRACKS_BESIDE_TRANSLATIONS = ["fr", "es"];
const LIVE_TIMEOUT_MS = 60_000;
const SINTEL_TITLE = "Sintel - Open Movie by Blender Foundation";
const SINTEL_CHAPTERS = [
  { title: "Introduction", startSeconds: 0 },
  { title: "The quest for the dragon", startSeconds: 93 },
  { title: "The shaman's revelation", startSeconds: 433 },
  { title: "Conclusion and credits", startSeconds: 745 },
];

describe.skipIf(process.env.MEDIA_MCP_LIVE !== "1")(
  "live against the real yt-dlp and YouTube",
  () => {
    const temp = withTempDir("media-mcp-live-");
    let services: ReturnType<typeof createMediaServices>;
    let processCount: () => number;

    beforeEach(() => {
      const config = unwrap(
        loadConfig({
          env: {
            MEDIA_MCP_OUTPUT_DIR: join(temp.path, "out"),
            MEDIA_MCP_CACHE_DIR: join(temp.path, "cache"),
          },
        }),
      );
      let started = 0;
      const counting: ProcessRunner = (command, args, options) => {
        started += 1;
        return runProcess(command, args, options);
      };
      processCount = () => started;
      services = createMediaServices(config, { run: counting });
    });

    const input = { ...EN, urls: [SINTEL_URL], maxItems: 1 };

    it(
      "fetches a transcript and serves the same request from the cache without starting a process",
      async () => {
        const first = await services.transcripts.fetch(input);
        const startedAfterFirst = processCount();
        const second = await services.transcripts.fetch(input);

        expect(first.entries).toMatchObject([
          {
            ok: true,
            value: {
              mode: "inline",
              source: "manual",
              language: "en",
              title: SINTEL_TITLE,
              text: expect.stringMatching(/^This blade has a dark past/),
              wordCount: expect.any(Number),
            },
          },
        ]);
        expect(second).toEqual(first);
        expect(startedAfterFirst).toBeGreaterThan(0);
        expect(processCount()).toBe(startedAfterFirst);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      "fetches manual tracks whose machine translations YouTube throttles, then still serves English",
      async () => {
        for (const language of MANUAL_TRACKS_BESIDE_TRANSLATIONS) {
          const { entries } = await services.transcripts.fetch({
            ...input,
            language,
          });
          expect(entries).toMatchObject([
            { ok: true, value: { source: "manual", language } },
          ]);
        }
        const english = await services.transcripts.fetch(input);
        expect(english.entries).toMatchObject([
          { ok: true, value: { language: "en" } },
        ]);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      "reports an unavailable video as VIDEO_UNAVAILABLE and keeps serving others",
      async () => {
        const request = (url: string) =>
          services.info.fetch({
            urls: [url],
            maxItems: 1,
            startIndex: FIRST_ITEM,
          });

        const unavailable = await request(UNAVAILABLE_URL);
        const playable = await request(BIG_BUCK_BUNNY_URL);

        expect(unavailable.entries).toMatchObject([
          { ok: false, error: { code: "VIDEO_UNAVAILABLE" } },
        ]);
        expect(playable.entries).toMatchObject([{ ok: true }]);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      "fetches the title and the chapters",
      async () => {
        const { entries } = await services.info.fetch({
          urls: [SINTEL_URL],
          maxItems: 1,
          startIndex: FIRST_ITEM,
        });

        expect(entries).toMatchObject([
          {
            ok: true,
            value: { title: SINTEL_TITLE, chapters: SINTEL_CHAPTERS },
          },
        ]);
      },
      LIVE_TIMEOUT_MS,
    );
  },
);
