import { describe, expect, it } from "vitest";
import { wrapForFile } from "../src/services/transcript-wrap.js";

const lengthsOf = (text: string): number[] =>
  text.split("\n").map((line) => line.length);

describe("wrapForFile", () => {
  it("breaks a long line on word boundaries without losing a word", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`);

    const wrapped = wrapForFile(words.join(" "));

    expect(lengthsOf(wrapped)).toEqual([94, 97, 97, 97, 20]);
    expect(wrapped.replaceAll("\n", " ")).toBe(words.join(" "));
  });

  it("fills each line as far as the width allows", () => {
    const wrapped = wrapForFile(
      `${"a".repeat(60)} ${"b".repeat(39)} ${"c".repeat(5)}`,
    );

    expect(lengthsOf(wrapped)).toEqual([100, 5]);
  });

  it("splits a word longer than the width by code points", () => {
    const wrapped = wrapForFile("😀".repeat(250));

    expect(wrapped.split("\n").map((line) => Array.from(line).length)).toEqual([
      100, 100, 50,
    ]);
  });

  it("keeps existing line breaks and leaves short lines alone", () => {
    const text = "[0:01] first\n[0:05] second\n\n[0:09] third";

    expect(wrapForFile(text)).toBe(text);
  });

  it("wraps only the long lines of a timestamped text", () => {
    const long = `[0:01] ${"word ".repeat(40).trim()}`;

    const wrapped = wrapForFile(`[0:00] short\n${long}`);

    expect(lengthsOf(wrapped)).toEqual([12, 96, 99, 9]);
    expect(wrapped.split("\n")[0]).toBe("[0:00] short");
  });
});
