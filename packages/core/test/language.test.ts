import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_TAG_PATTERN,
} from "../src/domain/language.js";

describe("LANGUAGE_TAG_PATTERN", () => {
  it.each([
    DEFAULT_LANGUAGE,
    "es",
    "fil",
    "pt-BR",
    "es-419",
    "zh-Hans-CN",
    "en-orig",
  ])("accepts the language code %s", (code) => {
    expect(LANGUAGE_TAG_PATTERN.test(code)).toBe(true);
  });

  it.each([
    "all",
    "ALL",
    ".*",
    "en,es",
    "",
    " en",
    "en ",
    "e",
    "english",
    "en-",
    "en_US",
    "^en$",
    "en|es",
  ])("rejects %j", (code) => {
    expect(LANGUAGE_TAG_PATTERN.test(code)).toBe(false);
  });
});
