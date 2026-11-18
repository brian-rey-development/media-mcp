import type { CaptionLanguages, CaptionSource } from "../../domain/media.js";

const TRACK_ID_LENGTH = 11;
const TRACK_ID_CHARS = `[A-Za-z0-9_-]{${TRACK_ID_LENGTH}}`;
const TRACK_ID = new RegExp(`^${TRACK_ID_CHARS}$`);
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ORIGINAL_SUFFIX = "-orig";
const MAX_HINT_LANGUAGES = 30;
const SAFE_PATTERN_CHAR = /[A-Za-z0-9_-]/;
const FIRST_NON_LATIN1_CODE = 256;
const HEX_RADIX = 16;

export interface CaptionTracks {
  manual: readonly string[];
  auto: readonly string[];
}

export interface CaptionChoice {
  key: string;
  source: CaptionSource;
}

const escapeCodeUnit = (char: string): string => {
  if (SAFE_PATTERN_CHAR.test(char)) return char;
  const code = char.charCodeAt(0);
  return code < FIRST_NON_LATIN1_CODE
    ? `\\x${code.toString(HEX_RADIX).padStart(2, "0")}`
    : `\\u${code.toString(HEX_RADIX).padStart(4, "0")}`;
};

const literalPattern = (text: string): string =>
  [...text.replace(/[\uD800-\uDFFF]/g, "\uFFFF")].map(escapeCodeUnit).join("");

export const candidatePattern = (language: string): string =>
  `^${literalPattern(language)}(?:${ORIGINAL_SUFFIX}|-${TRACK_ID_CHARS})?$`;

export const exactPattern = (key: string): string => `^${literalPattern(key)}$`;

const isSafeKey = (key: string): boolean => SAFE_KEY.test(key);

const withoutTrackId = (key: string): string | undefined => {
  const cut = key.length - TRACK_ID_LENGTH - 1;
  const hasTrackId =
    cut > 0 && key[cut] === "-" && TRACK_ID.test(key.slice(cut + 1));
  return hasTrackId ? key.slice(0, cut) : undefined;
};

const manualLanguage = (key: string): string => withoutTrackId(key) ?? key;

const originalLanguage = (key: string): string | undefined =>
  key.endsWith(ORIGINAL_SUFFIX)
    ? key.slice(0, -ORIGINAL_SUFFIX.length)
    : undefined;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const findManual = (
  keys: readonly string[],
  language: string,
): string | undefined =>
  keys.find((key) => key === language) ??
  keys.find((key) => withoutTrackId(key) === language);

export const selectCaption = (
  { manual, auto }: CaptionTracks,
  language: string,
): CaptionChoice | undefined => {
  const manualKey = findManual(manual.filter(isSafeKey), language);
  if (manualKey) return { key: manualKey, source: "manual" };
  const original = language.endsWith(ORIGINAL_SUFFIX)
    ? language
    : `${language}${ORIGINAL_SUFFIX}`;
  return isSafeKey(original) && auto.includes(original)
    ? { key: original, source: "auto" }
    : undefined;
};

export const captionLanguages = ({
  manual,
  auto,
}: CaptionTracks): CaptionLanguages => ({
  manual: unique(manual.map(manualLanguage)),
  auto: unique(
    auto.flatMap((key) => {
      const language = originalLanguage(key);
      return language === undefined ? [] : [language];
    }),
  ),
});

export const captionHint = (tracks: CaptionTracks): string => {
  const { manual, auto } = captionLanguages(tracks);
  const labelled = [
    ...manual.map((language) => `${language} (manual)`),
    ...auto
      .filter((language) => !manual.includes(language))
      .map((language) => `${language} (auto)`),
  ];
  if (labelled.length === 0)
    return "This video has no manual or automatic captions";
  const shown = labelled.slice(0, MAX_HINT_LANGUAGES).join(", ");
  const hidden = labelled.length - MAX_HINT_LANGUAGES;
  return `Retry with language set to one of: ${shown}${hidden > 0 ? ` and ${hidden} more` : ""}`;
};
