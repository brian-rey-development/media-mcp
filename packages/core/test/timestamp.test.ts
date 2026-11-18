import { describe, expect, it } from "vitest";
import { formatTimestamp } from "../src/domain/timestamp.js";

describe("formatTimestamp", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [888, "14:48"],
    [3_599, "59:59"],
    [3_600, "1:00:00"],
    [3_661, "1:01:01"],
    [36_000, "10:00:00"],
  ])("formats %d seconds as %s", (seconds, expected) => {
    expect(formatTimestamp(seconds)).toBe(expected);
  });

  it("drops the fraction of a second", () => {
    expect(formatTimestamp(61.9)).toBe("1:01");
  });
});
