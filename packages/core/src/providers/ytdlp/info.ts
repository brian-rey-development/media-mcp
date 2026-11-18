import { z } from "zod";
import type { VideoInfo, VideoRef } from "../../domain/media.js";
import type { Result } from "../../domain/result.js";
import { omitUndefined } from "../../infra/options.js";
import { metadataArgs } from "./args.js";
import { type CaptionTracks, captionLanguages } from "./captions.js";
import { type ClientProfile, withFallbackProfile } from "./client-profile.js";
import { execYtDlp, type YtDlpDeps } from "./exec.js";
import { parseYtDlpJson, printTemplate } from "./parse.js";

const textOrEmpty = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

const textOrUndefined = z
  .string()
  .nullish()
  .transform((value) => value || undefined);

const languageKeys = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((captions) => Object.keys(captions ?? {}));

const chapterList = z
  .array(z.object({ title: z.string(), start_time: z.number() }))
  .nullish()
  .transform((chapters) =>
    (chapters ?? []).map(({ title, start_time }) => ({
      title,
      startSeconds: start_time,
    })),
  );

export const ListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel: textOrUndefined,
  subtitles: languageKeys,
  automatic_captions: languageKeys,
});

const InfoSchema = ListingSchema.extend({
  duration: z
    .number()
    .nullish()
    .transform((seconds) => seconds ?? undefined),
  description: textOrEmpty,
  chapters: chapterList,
});

export type YtDlpListing = z.output<typeof ListingSchema>;

type YtDlpInfo = z.output<typeof InfoSchema>;

export const tracksOf = ({
  subtitles,
  automatic_captions,
}: YtDlpListing): CaptionTracks => ({
  manual: subtitles,
  auto: automatic_captions,
});

const fetchInfoOnce = async (
  deps: YtDlpDeps,
  url: string,
  profile: ClientProfile,
  signal?: AbortSignal,
): Promise<Result<YtDlpInfo>> => {
  const args = metadataArgs(
    profile,
    ["--print", printTemplate(InfoSchema)],
    url,
  );
  const run = await execYtDlp(deps, args, { signal });
  return run.ok ? parseYtDlpJson(InfoSchema, run.value.stdout) : run;
};

export const fetchInfo = (
  deps: YtDlpDeps,
  url: string,
  signal?: AbortSignal,
): Promise<Result<YtDlpInfo>> =>
  withFallbackProfile((profile) => fetchInfoOnce(deps, url, profile, signal));

export const toVideoInfo = (info: YtDlpInfo, ref: VideoRef): VideoInfo => ({
  ref,
  title: info.title,
  description: info.description,
  chapters: info.chapters,
  captionLanguages: captionLanguages(tracksOf(info)),
  ...omitUndefined({
    channel: info.channel,
    durationSeconds: info.duration,
  }),
});
