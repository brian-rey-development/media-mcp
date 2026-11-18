import { describe, expect, it } from "vitest";
import {
  isHttpUrl,
  MAX_URL_LENGTH,
  parseHttpUrl,
} from "../src/infra/http-url.js";

const withLength = (length: number): string =>
  `https://example.com/${"a".repeat(length - "https://example.com/".length)}`;

describe("isHttpUrl", () => {
  it.each(["http://example.com", "https://example.com/a?b=c#d"])(
    "accepts %s",
    (url) => {
      expect(isHttpUrl(url)).toBe(true);
    },
  );

  it.each(["ftp://example.com", "file:///etc/passwd", "--exec=x", "", "a b"])(
    "rejects %j",
    (url) => {
      expect(isHttpUrl(url)).toBe(false);
    },
  );

  it("accepts a link of exactly the maximum length", () => {
    expect(isHttpUrl(withLength(MAX_URL_LENGTH))).toBe(true);
  });

  it("rejects a link one character over the maximum", () => {
    expect(isHttpUrl(withLength(MAX_URL_LENGTH + 1))).toBe(false);
    expect(parseHttpUrl(withLength(MAX_URL_LENGTH + 1))).toBeUndefined();
  });
});
