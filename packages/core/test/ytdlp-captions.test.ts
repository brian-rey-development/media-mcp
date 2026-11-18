import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type CaptionTracks,
  candidatePattern,
  captionHint,
  captionLanguages,
  exactPattern,
  selectCaption,
} from "../src/providers/ytdlp/captions.js";
import { readFixture } from "./support/fixtures.js";

const SintelListing = z.object({
  subtitles: z.record(z.string(), z.unknown()),
  automatic_captions: z.record(z.string(), z.unknown()),
});
const sintel = SintelListing.parse(
  JSON.parse(await readFixture("sintel.info.json")),
);
const SINTEL: CaptionTracks = {
  manual: Object.keys(sintel.subtitles),
  auto: Object.keys(sintel.automatic_captions),
};

const tracks = (manual: string[], auto: string[]): CaptionTracks => ({
  manual,
  auto,
});

describe("selectCaption against the recorded Sintel listing", () => {
  it("picks the manual track for a plain language key", () => {
    expect(selectCaption(SINTEL, "en")).toEqual({
      key: "en",
      source: "manual",
    });
  });

  it("finds a manual track whose key carries a track id suffix", () => {
    expect(selectCaption(SINTEL, "es")).toEqual({
      key: "es-3pK74FgVxOs",
      source: "manual",
    });
    expect(selectCaption(SINTEL, "nl")).toEqual({
      key: "nl-3qLcwtbWM-Y",
      source: "manual",
    });
  });

  it("accepts an exact suffixed key as written", () => {
    expect(selectCaption(SINTEL, "es-3pK74FgVxOs")).toEqual({
      key: "es-3pK74FgVxOs",
      source: "manual",
    });
  });

  it("does not treat a machine translation as an automatic caption", () => {
    expect(selectCaption(SINTEL, "ja")).toEqual({
      key: "ja",
      source: "manual",
    });
    expect(selectCaption(SINTEL, "hy")).toBeUndefined();
    expect(selectCaption(SINTEL, "af")).toBeUndefined();
  });

  it("does not let a language prefix match a longer language", () => {
    expect(selectCaption(SINTEL, "zh")).toBeUndefined();
    expect(selectCaption(SINTEL, "pt")).toEqual({
      key: "pt-EP72IGCJZ2Y",
      source: "manual",
    });
  });
});

describe("selectCaption automatic captions", () => {
  const auto = tracks([], ["en-orig", "en", "fr", "de-orig"]);

  it("accepts the original track when the plain language is requested", () => {
    expect(selectCaption(auto, "en")).toEqual({
      key: "en-orig",
      source: "auto",
    });
    expect(selectCaption(auto, "de")).toEqual({
      key: "de-orig",
      source: "auto",
    });
  });

  it("accepts the original track when it is requested by its own key", () => {
    expect(selectCaption(auto, "en-orig")).toEqual({
      key: "en-orig",
      source: "auto",
    });
  });

  it("rejects a plain automatic key that has no original track", () => {
    expect(selectCaption(auto, "fr")).toBeUndefined();
  });

  it("prefers manual captions over automatic ones", () => {
    expect(selectCaption(tracks(["en"], ["en-orig"]), "en")).toEqual({
      key: "en",
      source: "manual",
    });
  });

  it("ignores keys that could carry regular expression syntax", () => {
    expect(selectCaption(tracks(["a|b", "-x"], []), "a|b")).toBeUndefined();
    expect(selectCaption(tracks(["-x"], []), "-x")).toBeUndefined();
  });
});

describe("captionLanguages", () => {
  it("reports manual languages without track ids and only original automatic ones", () => {
    const { manual, auto } = captionLanguages(SINTEL);

    expect(manual).toContain("es");
    expect(manual).toContain("en");
    expect(manual).not.toContain("es-3pK74FgVxOs");
    expect(auto).toEqual(["en"]);
  });

  it("reports nothing for a video without captions", () => {
    expect(captionLanguages(tracks([], []))).toEqual({ manual: [], auto: [] });
  });
});

describe("captionHint", () => {
  it("labels each language and tells the caller how to retry", () => {
    expect(captionHint(tracks(["en", "es-3pK74FgVxOs"], ["ja-orig"]))).toBe(
      "Retry with language set to one of: en (manual), es (manual), ja (auto)",
    );
  });

  it("caps a very long list", () => {
    const manual = Array.from({ length: 40 }, (_, index) => `l${index}`);

    expect(captionHint(tracks(manual, []))).toMatch(/ and 10 more$/);
  });

  it("says so when there are no captions at all", () => {
    expect(captionHint(tracks([], []))).toBe(
      "This video has no manual or automatic captions",
    );
  });
});

describe("candidatePattern", () => {
  it("is anchored so it covers the language, its original automatic track and its id-suffixed manual tracks only", () => {
    const pattern = new RegExp(candidatePattern("es"));

    for (const key of ["es", "es-orig", "es-3pK74FgVxOs"]) {
      expect(pattern.test(key)).toBe(true);
    }
    for (const key of [
      "en",
      "es-419",
      "es-ES",
      "xes",
      "es-orig-orig",
      "es-",
      "es-3pK74FgVxOsX",
    ]) {
      expect(pattern.test(key)).toBe(false);
    }
  });

  it.each(["all", ".*", "en,es", "en|es", "(", "a b", "\n"])(
    "treats the hostile language %j as literal text that matches no real track",
    (language) => {
      const pattern = candidatePattern(language);

      expect(pattern).not.toContain(",");
      for (const key of ["en", "es", "ja-orig", "zh-Hans", "x"]) {
        expect(new RegExp(pattern).test(key)).toBe(false);
      }
    },
  );
});

describe("exactPattern", () => {
  it("matches only the key itself", () => {
    const pattern = new RegExp(exactPattern("es-3pK74FgVxOs"));

    expect(pattern.test("es-3pK74FgVxOs")).toBe(true);
    expect(pattern.test("es-3pK74FgVxOs-orig")).toBe(false);
    expect(pattern.test("xes-3pK74FgVxOs")).toBe(false);
  });

  it("escapes characters that mean something to a pattern", () => {
    expect(exactPattern("a.b+c")).toBe("^a\\x2eb\\x2bc$");
  });
});
