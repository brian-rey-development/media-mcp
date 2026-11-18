// Bump when the json3 parser, the info mapping or the shape of Transcript or VideoInfo changes, so an entry written by an older build is never served as if it were current.
export const CACHE_FORMAT_VERSION = 2;

export const versionedKey = (key: string): string =>
  `v${CACHE_FORMAT_VERSION}:${key}`;
