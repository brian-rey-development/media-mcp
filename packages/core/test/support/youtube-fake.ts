import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { VideoRef } from "../../src/domain/media.js";
import type { ProcessRunner } from "../../src/infra/process.js";
import { createYoutubeProvider } from "../../src/providers/youtube/provider.js";
import { captionFilesFor } from "./caption-emulation.js";
import { testConfig } from "./config.js";
import { createFakeRunner, stdoutOf } from "./fake-runner.js";

export const VIDEO_ID = "eRsGyueVLvQ";
export const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
export const REF: VideoRef = {
  provider: "youtube",
  id: VIDEO_ID,
  url: VIDEO_URL,
};
export const EN = { language: "en", timestamps: false };
export const PLAYLIST_URL =
  "https://www.youtube.com/playlist?list=PLa1F2ddGya_84ye1JAvIGh0Yp7utEKZI_";

export const provider = (run: ProcessRunner, config = testConfig) =>
  createYoutubeProvider({ run, downloadRun: run, config });

export const INJECTIONS = [
  "--exec=touch /tmp/x",
  "-o /etc/x",
  "",
  "ftp://youtube.com/x",
];

interface YtDlpFixtures {
  info?: string;
  playlist?: string;
  captions?: string;
}

const ListingSchema = z.object({
  subtitles: z.record(z.string(), z.unknown()).default({}),
  automatic_captions: z.record(z.string(), z.unknown()).default({}),
});

export const ytDlpFake = ({
  info = "",
  playlist = "",
  captions,
}: YtDlpFixtures) =>
  createFakeRunner(async ({ args, options }) => {
    if (args.includes("--flat-playlist")) return stdoutOf(playlist);
    if (options.cwd && captions !== undefined && info) {
      const listing = ListingSchema.parse(JSON.parse(info));
      for (const { name } of captionFilesFor(args, listing))
        await writeFile(join(options.cwd, name), captions);
    }
    return stdoutOf(info);
  });
