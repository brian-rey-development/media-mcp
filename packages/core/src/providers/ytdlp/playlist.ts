import { z } from "zod";
import { ok, type Result } from "../../domain/result.js";
import type { Resolved, ResolveOptions } from "../provider.js";
import { metadataArgs } from "./args.js";
import { execYtDlp, type YtDlpDeps } from "./exec.js";
import { parseYtDlpJson } from "./parse.js";

const PlaylistSchema = z.object({
  playlist_count: z.number().nullish(),
  entries: z
    .array(z.object({ id: z.string() }).nullish())
    .transform((entries) => entries.filter((entry) => entry != null)),
});

type YtDlpPlaylist = z.output<typeof PlaylistSchema>;

// Ids keep their repeats, because the services count playlist positions to place the next window.
type PlaylistListing = Omit<Resolved, "refs"> & { ids: readonly string[] };

const playlistArgs = (
  url: string,
  { maxItems, startIndex }: ResolveOptions,
): string[] =>
  metadataArgs(
    "standard",
    [
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-start",
      String(startIndex),
      "--playlist-end",
      String(startIndex + maxItems),
    ],
    url,
  );

const toListing = (
  { entries, playlist_count }: YtDlpPlaylist,
  { maxItems, startIndex }: ResolveOptions,
): PlaylistListing => {
  const observed = entries.length === 0 ? 0 : startIndex - 1 + entries.length;
  return {
    ids: entries.slice(0, maxItems).map((entry) => entry.id),
    total: playlist_count ?? observed,
    totalExact: playlist_count != null || entries.length <= maxItems,
  };
};

export const listPlaylist = async (
  deps: YtDlpDeps,
  url: string,
  window: ResolveOptions,
  signal?: AbortSignal,
): Promise<Result<PlaylistListing>> => {
  const run = await execYtDlp(deps, playlistArgs(url, window), { signal });
  if (!run.ok) return run;
  const playlist = parseYtDlpJson(PlaylistSchema, run.value.stdout);
  return playlist.ok ? ok(toListing(playlist.value, window)) : playlist;
};
