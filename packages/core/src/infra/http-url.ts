export const MAX_URL_LENGTH = 2048;
const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

export const parseHttpUrl = (value: string): URL | undefined => {
  if (value.length > MAX_URL_LENGTH) return undefined;
  const url = URL.parse(value);
  return url && HTTP_PROTOCOLS.has(url.protocol) ? url : undefined;
};

export const isHttpUrl = (value: string): boolean =>
  parseHttpUrl(value) !== undefined;
