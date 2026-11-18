interface Listing {
  subtitles?: Record<string, unknown> | null;
  automatic_captions?: Record<string, unknown> | null;
}

interface CaptionFile {
  name: string;
  source: "manual" | "auto";
}

const DEFAULT_SUBTITLE_FORMAT = "vtt";

const TRACK_GROUPS = [
  { flag: "--write-subs", field: "subtitles", source: "manual" },
  { flag: "--write-auto-subs", field: "automatic_captions", source: "auto" },
] as const;

export const valueAfter = (
  args: readonly string[],
  flag: string,
): string | undefined => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

export const captionFilesFor = (
  args: readonly string[],
  listing: Listing,
): CaptionFile[] => {
  const pattern = valueAfter(args, "--sub-langs");
  const basename = valueAfter(args, "-o");
  if (pattern === undefined || basename === undefined) return [];
  const wanted = new RegExp(pattern);
  const extension = valueAfter(args, "--sub-format") ?? DEFAULT_SUBTITLE_FORMAT;
  return TRACK_GROUPS.filter(({ flag }) => args.includes(flag)).flatMap(
    ({ field, source }) =>
      Object.keys(listing[field] ?? {})
        .filter((key) => wanted.test(key))
        .map((key) => ({ name: `${basename}.${key}.${extension}`, source })),
  );
};
