import { describe, expect, it } from "vitest";
import { parseJson3 } from "../src/providers/ytdlp/json3.js";
import { readFixture } from "./support/fixtures.js";
import { unwrap } from "./support/unwrap.js";

const TIMESTAMP_PREFIX = /^\[\d+:\d{2}\] /;
const ANY_TIMESTAMP = /\[\d+:\d{2}\]/;
const MS_PER_SECOND = 1_000;
const TEXT_ONLY = { timestamps: false };
const STAMPED = { timestamps: true };

interface TestEvent {
  tStartMs: number;
  dDurationMs?: number;
  text: string;
}

const textOf = (raw: string, options: { timestamps: boolean }): string =>
  unwrap(parseJson3(raw, options)).text;

const json3 = (events: TestEvent[]): string =>
  JSON.stringify({
    events: events.map(({ tStartMs, dDurationMs, text }) => ({
      tStartMs,
      ...(dDurationMs !== undefined && { dDurationMs }),
      segs: [{ utf8: text }],
    })),
  });

const parsed = (events: TestEvent[], options = TEXT_ONLY) =>
  unwrap(parseJson3(json3(events), options));

describe("parseJson3 against a recorded auto-caption track", () => {
  it("returns clean prose without timestamps, newlines or runs of spaces", async () => {
    const text = textOf(await readFixture("sintel.auto.en.json3"), TEXT_ONLY);

    expect(text).toContain("this blade has a dark past it has shed much");
    expect(text).not.toMatch(ANY_TIMESTAMP);
    expect(text).not.toMatch(/\s{2}|\n/);
    expect(text).toBe(text.trim());
  });

  it("collapses the recorded track's repeated sound cues into one line", async () => {
    const lines = textOf(
      await readFixture("sintel.auto.en.json3"),
      STAMPED,
    ).split("\n");
    const bodies = lines.map((line) => line.replace(TIMESTAMP_PREFIX, ""));

    expect(bodies.slice(0, 2)).toEqual([
      "[Music]",
      "this blade has a dark past",
    ]);
  });

  it("prefixes every line with an m:ss timestamp when asked", async () => {
    const lines = textOf(
      await readFixture("sintel.auto.en.json3"),
      STAMPED,
    ).split("\n");

    expect(lines[0]).toBe("[0:01] [Music]");
    expect(lines.filter((line) => !TIMESTAMP_PREFIX.test(line))).toEqual([]);
  });
});

describe("parseJson3 against a recorded auto-caption track with spoken repeats", () => {
  it("keeps every spoken repetition, including back to back ones", async () => {
    const lines = textOf(
      await readFixture("sintel.auto.en.json3"),
      STAMPED,
    ).split("\n");
    const bodies = lines.map((line) => line.replace(TIMESTAMP_PREFIX, ""));

    expect(bodies.filter((body) => body === "Oh")).toHaveLength(4);
    expect(
      bodies.some((body, i) => body === "Oh" && bodies[i - 1] === "Oh"),
    ).toBe(true);
  });
});

describe("parseJson3 against a recorded manual track", () => {
  it("keeps the authored sentences in order", async () => {
    const text = textOf(await readFixture("sintel.en.json3"), TEXT_ONLY);

    expect(text).toMatch(/^This blade has a dark past\. It has shed much/);
    expect(text).toContain("You're a fool for traveling alone, so completely");
  });
});

describe("parseJson3 repeats", () => {
  it("collapses a rolling two-line window into each line once", () => {
    const events = [
      {
        tStartMs: 0,
        dDurationMs: 4 * MS_PER_SECOND,
        text: "first line\nsecond line",
      },
      {
        tStartMs: 2 * MS_PER_SECOND,
        dDurationMs: 4 * MS_PER_SECOND,
        text: "second line\nthird line",
      },
    ];

    expect(parsed(events).text).toBe("first line second line third line");
  });

  it("keeps a legitimate repeat that appears in a later caption", () => {
    const events = [
      { tStartMs: 0, dDurationMs: MS_PER_SECOND, text: "No." },
      { tStartMs: 2 * MS_PER_SECOND, dDurationMs: MS_PER_SECOND, text: "No." },
    ];

    expect(parsed(events).text).toBe("No. No.");
    expect(parsed(events).wordCount).toBe(2);
  });

  it("keeps a repeat inside a single caption", () => {
    expect(parsed([{ tStartMs: 0, text: "no no" }]).text).toBe("no no");
  });

  it("keeps a repeat when the earlier caption has no known duration", () => {
    const events = [
      { tStartMs: 0, text: "go" },
      { tStartMs: MS_PER_SECOND, text: "go" },
    ];

    expect(parsed(events).text).toBe("go go");
  });

  it("collapses consecutive identical sound cues only", () => {
    const events = [
      { tStartMs: 0, text: "[Music]" },
      { tStartMs: 5 * MS_PER_SECOND, text: "[Music]" },
      { tStartMs: 9 * MS_PER_SECOND, text: "word" },
      { tStartMs: 12 * MS_PER_SECOND, text: "[Music]" },
    ];

    expect(parsed(events).text).toBe("[Music] word [Music]");
  });
});

describe("parseJson3 text cleaning", () => {
  it("strips zero-width characters", () => {
    const events = [{ tStartMs: 0, text: "he​llo‍ ﻿world⁠" }];

    expect(parsed(events).text).toBe("hello world");
  });

  it("never emits a lone surrogate", () => {
    const text = parsed([{ tStartMs: 0, text: "ok \uD83D broken" }]).text;

    expect(text.isWellFormed()).toBe(true);
  });

  it("keeps a well formed emoji intact", () => {
    expect(parsed([{ tStartMs: 0, text: "great \u{1F600}" }]).text).toBe(
      "great \u{1F600}",
    );
  });
});

describe("parseJson3 word count", () => {
  it("counts only spoken words, identically with timestamps on or off", () => {
    const events = [
      { tStartMs: 0, text: "one two" },
      { tStartMs: 2 * MS_PER_SECOND, text: "three four five" },
    ];

    expect(parsed(events, TEXT_ONLY).wordCount).toBe(5);
    expect(parsed(events, STAMPED).wordCount).toBe(5);
  });

  it("excludes bracketed cues", () => {
    const events = [{ tStartMs: 0, text: "[Music] hello [Applause] there" }];

    expect(parsed(events).wordCount).toBe(2);
  });

  it("collapses runs of whitespace and newlines before counting", () => {
    const result = parsed([{ tStartMs: 0, text: "one  two three\nfour" }]);

    expect(result).toEqual({ text: "one two three four", wordCount: 4 });
  });
});

describe("parseJson3 structure", () => {
  it("returns empty text and no words for an empty events list", () => {
    for (const options of [TEXT_ONLY, STAMPED]) {
      expect(unwrap(parseJson3('{"events":[]}', options))).toEqual({
        text: "",
        wordCount: 0,
      });
    }
  });

  it("defaults a missing start time to zero and a missing utf8 to empty", () => {
    const raw = JSON.stringify({
      events: [{ segs: [{ utf8: "hi" }, {}] }],
    });

    expect(textOf(raw, STAMPED)).toBe("[0:00] hi");
  });

  it("skips malformed events and keeps the usable ones", () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: "soon", segs: [] },
        "nonsense",
        { tStartMs: 0, segs: [{ utf8: "kept" }] },
        { tStartMs: 1, segs: "bad" },
      ],
    });

    expect(textOf(raw, TEXT_ONLY)).toBe("kept");
  });

  it("fails with PARSE_FAILED when no event is usable", () => {
    const raw = JSON.stringify({ events: ["a", 1, null] });

    expect(parseJson3(raw, TEXT_ONLY)).toMatchObject({
      ok: false,
      error: { code: "PARSE_FAILED" },
    });
  });

  it.each([
    ["a document that is not json3", '{"nope":1}'],
    ["text that is not JSON", "{broken"],
  ])("rejects %s with a short PARSE_FAILED message", (_label, raw) => {
    const result = parseJson3(raw, TEXT_ONLY);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PARSE_FAILED" },
    });
    expect(result.ok ? "" : result.error.message).not.toMatch(/[[{]/);
  });
});
