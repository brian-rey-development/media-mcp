import { err, ok, type Result } from "../../domain/result.js";
import { parseHttpUrl } from "../../infra/http-url.js";

type YoutubeTarget =
  | { kind: "video"; id: string }
  | { kind: "playlist"; id: string };

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const SHORT_LINK_HOST = "youtu.be";
const MAX_PLAYLIST_ID_LENGTH = 64;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${MAX_PLAYLIST_ID_LENGTH}}$`,
);
const WATCH_SEGMENT = "watch";
const PLAYLIST_SEGMENT = "playlist";
const EMBED_SEGMENT = "embed";
const ID_IN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "shorts",
  EMBED_SEGMENT,
  "live",
  "v",
]);
const EMBEDDED_PLAYLIST_ID = "videoseries";
const WATCH_BASE = "https://www.youtube.com/watch?v=";
const PLAYLIST_BASE = "https://www.youtube.com/playlist?list=";
const TRAILING_DOT = /\.$/;

export const canonicalVideoUrl = (id: string): string => `${WATCH_BASE}${id}`;

export const canonicalPlaylistUrl = (id: string): string =>
  `${PLAYLIST_BASE}${id}`;

const hostOf = (url: URL): string => url.hostname.replace(TRAILING_DOT, "");

const videoTarget = (id: string | null | undefined): Result<YoutubeTarget> =>
  id && VIDEO_ID_PATTERN.test(id)
    ? ok({ kind: "video", id })
    : err(
        "INVALID_URL",
        "The URL does not carry a valid YouTube video id",
        "A video id is 11 characters of letters, digits, dashes and underscores",
      );

const playlistTarget = (id: string | null): Result<YoutubeTarget> =>
  id && PLAYLIST_ID_PATTERN.test(id)
    ? ok({ kind: "playlist", id })
    : err(
        "INVALID_URL",
        "The URL does not carry a valid YouTube playlist id",
        "Use a link such as https://www.youtube.com/playlist?list=PL...",
      );

const embeddedPlaylist = (): Result<never> =>
  err(
    "INVALID_URL",
    "Embedded playlist links are not supported",
    "Use a link such as https://www.youtube.com/playlist?list=PL...",
  );

const fromWatch = (url: URL): Result<YoutubeTarget> => {
  const video = url.searchParams.get("v");
  return video === null
    ? playlistTarget(url.searchParams.get("list"))
    : videoTarget(video);
};

const fromIdSegment = (
  url: URL,
  first: string,
  second: string | undefined,
): Result<YoutubeTarget> =>
  first === EMBED_SEGMENT &&
  (second === EMBEDDED_PLAYLIST_ID || url.searchParams.has("list"))
    ? embeddedPlaylist()
    : videoTarget(second);

const fromYoutubeHost = (url: URL): Result<YoutubeTarget> => {
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (first === WATCH_SEGMENT) return fromWatch(url);
  if (first === PLAYLIST_SEGMENT)
    return playlistTarget(url.searchParams.get("list"));
  if (first && ID_IN_PATH_SEGMENTS.has(first))
    return fromIdSegment(url, first, second);
  return err(
    "UNSUPPORTED_URL",
    "Only YouTube video and playlist links are supported",
    "Use a watch, youtu.be, shorts, live, embed or playlist link",
  );
};

const unsupportedHost = (url: URL): Result<never> =>
  err(
    "UNSUPPORTED_URL",
    `${url.hostname} is not a supported video site`,
    "Only YouTube links are supported",
  );

export const isYoutubeHost = (input: string): boolean => {
  const url = URL.parse(input);
  if (!url) return false;
  const host = hostOf(url);
  return host === SHORT_LINK_HOST || YOUTUBE_HOSTS.has(host);
};

export const videoUrlOf = (id: string): Result<string> => {
  const target = videoTarget(id);
  return target.ok ? ok(canonicalVideoUrl(id)) : target;
};

export const parseYoutubeUrl = (input: string): Result<YoutubeTarget> => {
  const url = parseHttpUrl(input);
  if (!url) {
    return err(
      "INVALID_URL",
      "Expected an http or https URL",
      "Pass the full link, for example https://www.youtube.com/watch?v=...",
    );
  }
  const host = hostOf(url);
  if (host === SHORT_LINK_HOST)
    return videoTarget(url.pathname.split("/").filter(Boolean)[0]);
  return YOUTUBE_HOSTS.has(host) ? fromYoutubeHost(url) : unsupportedHost(url);
};
