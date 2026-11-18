import type {
  BatchOutcome,
  DownloadResult,
  MediaError,
  Services,
  TranscriptDelivery,
  VideoRef,
} from "@media-mcp/core";

type Handlers = {
  [Name in keyof Services]?: Services[Name][keyof Services[Name]];
};

const unexpected = (): never => {
  throw new Error("unexpected service call");
};

export const fakeServices = ({
  transcripts = unexpected,
  info = unexpected,
  downloads = unexpected,
  transcriptFiles = unexpected,
}: Handlers = {}): Services => ({
  transcripts: { fetch: transcripts },
  info: { fetch: info },
  downloads: { run: downloads },
  transcriptFiles: { read: transcriptFiles },
});

export const requireSignal = (signal: AbortSignal | undefined): AbortSignal => {
  if (signal === undefined) throw new Error("called without a signal");
  return signal;
};

export const outcomeOf = <T>(
  entries: BatchOutcome<T>["entries"],
  truncations: BatchOutcome<T>["truncations"] = [],
): BatchOutcome<T> => ({ entries, truncations });

export const succeeded = <T>(url: string, value: T, inputUrl = url) => ({
  url,
  inputUrl,
  ok: true as const,
  value,
});

export const failedWith = (url: string, error: MediaError) => ({
  url,
  inputUrl: url,
  ok: false as const,
  error,
});

export const inlineTranscript = (
  ref: VideoRef,
  text: string,
): TranscriptDelivery => ({
  ref,
  title: `Title ${ref.id}`,
  channel: "A channel",
  language: "en",
  source: "manual",
  wordCount: text.split(" ").length,
  mode: "inline",
  text,
});

export const downloadedFile = (ref: VideoRef): DownloadResult => ({
  ref,
  filePath: `/out/${ref.id}.mp4`,
  kind: "video",
  bytes: 42,
});
