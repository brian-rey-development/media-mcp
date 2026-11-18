import type {
  Transcript,
  VideoInfo,
  VideoRef,
} from "../../src/domain/media.js";
import { err, ok } from "../../src/domain/result.js";
import type { Provider } from "../../src/providers/provider.js";

export interface Origin {
  name: string;
  host: string;
}

const FAKE: Origin = { name: "fake", host: "https://fake.example/" };
export const PLAYLIST_TOTAL = 12;
const SECOND_PLAYLIST_OFFSET = 100;
const VIDEO_ROUTES = new Set(["watch", "v", "embed"]);
const ID_DIGITS = 8;

export const videoId = (index: number): string =>
  `vid${String(index).padStart(ID_DIGITS, "0")}`;

export const watchUrl = (id: string, { host } = FAKE): string =>
  `${host}watch?v=${id}`;

export const shortUrl = (id: string, { host } = FAKE): string =>
  `${host}v/${id}`;

export const embedUrl = (id: string, { host } = FAKE): string =>
  `${host}embed/${id}`;

export const playlistUrl = (name: string, { host } = FAKE): string =>
  `${host}playlist?id=${name}`;

export const PLAYLIST_URL = playlistUrl("first");
export const SECOND_PLAYLIST_URL = playlistUrl("second");

const fakeRef = (id: string, origin = FAKE): VideoRef => ({
  provider: origin.name,
  id,
  url: watchUrl(id, origin),
});

interface Target {
  kind: "video" | "playlist";
  id: string;
}

const targetOf = (url: string): Target | undefined => {
  const parsed = URL.parse(url);
  if (!parsed) return undefined;
  const [route = "", segment = ""] = parsed.pathname.split("/").slice(1);
  if (route === "playlist")
    return { kind: "playlist", id: parsed.searchParams.get("id") ?? "" };
  const id = parsed.searchParams.get("v") ?? segment;
  return VIDEO_ROUTES.has(route) && id ? { kind: "video", id } : undefined;
};

interface FakeCalls {
  resolve: string[];
  transcript: VideoRef[];
  info: VideoRef[];
  download: VideoRef[];
  signals: (AbortSignal | undefined)[];
}

export const transcriptOf = (ref: VideoRef, text: string): Transcript => ({
  ref,
  title: `Title ${ref.id}`,
  language: "en",
  source: "manual",
  text,
  wordCount: text.split(" ").length,
});

const infoOf = (ref: VideoRef): VideoInfo => ({
  ref,
  title: `Title ${ref.id}`,
  channel: "Channel",
  durationSeconds: 60,
  description: "Description",
  chapters: [{ title: "Intro", startSeconds: 0 }],
  captionLanguages: { manual: ["en"], auto: [] },
});

const playlistRefs = (
  { id }: Target,
  { maxItems, startIndex }: { maxItems: number; startIndex: number },
  origin: Origin,
): VideoRef[] => {
  const offset = id === "second" ? SECOND_PLAYLIST_OFFSET : 0;
  const remaining = Math.max(PLAYLIST_TOTAL - (startIndex - 1), 0);
  return Array.from({ length: Math.min(maxItems, remaining) }, (_, index) =>
    fakeRef(videoId(offset + startIndex - 1 + index), origin),
  );
};

const resolving =
  (origin: Origin, calls: FakeCalls): Provider["resolve"] =>
  async (url, options) => {
    calls.resolve.push(url);
    const target = targetOf(url);
    if (!target) return err("INVALID_URL", `Not a ${origin.name} link`);
    if (target.kind === "video") {
      return ok({
        refs: [fakeRef(target.id, origin)],
        total: 1,
        totalExact: true,
      });
    }
    const refs = playlistRefs(target, options, origin);
    return ok({ refs, total: PLAYLIST_TOTAL, totalExact: true });
  };

const serving = (
  calls: FakeCalls,
): Pick<Provider, "getInfo" | "getTranscript" | "download"> => ({
  async getInfo(ref, signal) {
    calls.info.push(ref);
    calls.signals.push(signal);
    return ok(infoOf(ref));
  },
  async getTranscript(ref, _options, signal) {
    calls.transcript.push(ref);
    calls.signals.push(signal);
    return ok(transcriptOf(ref, `spoken words of ${ref.id}`));
  },
  async download(ref, { kind, outputDir, onProgress }, signal) {
    calls.download.push(ref);
    calls.signals.push(signal);
    onProgress?.(50);
    onProgress?.(100);
    return ok({ ref, filePath: `${outputDir}/${ref.id}.mp4`, kind, bytes: 10 });
  },
});

export const createFakeProvider = (
  overrides: Partial<Provider> = {},
  origin: Origin = FAKE,
) => {
  const calls: FakeCalls = {
    resolve: [],
    transcript: [],
    info: [],
    download: [],
    signals: [],
  };
  const provider: Provider = {
    name: origin.name,
    matches: (url) => url.startsWith(origin.host),
    resolve: resolving(origin, calls),
    ...serving(calls),
    ...overrides,
  };
  return { provider, calls };
};
