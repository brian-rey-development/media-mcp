import { describe, expect, it } from "vitest";
import { excerptOf } from "../src/infra/excerpt.js";

const LIMIT = 500;

describe("excerptOf", () => {
  it("returns short text whole", () => {
    expect(excerptOf("hello", LIMIT)).toBe("hello");
  });

  it("cuts long text at the limit", () => {
    expect(excerptOf("y".repeat(LIMIT * 3), LIMIT)).toBe("y".repeat(LIMIT));
  });

  it("never cuts a surrogate pair in half", () => {
    const text = `${"a".repeat(LIMIT - 1)}😀tail`;

    const preview = excerptOf(text, LIMIT);

    expect(preview).toBe("a".repeat(LIMIT - 1));
    expect(preview.isWellFormed()).toBe(true);
  });

  it("keeps a pair that ends exactly at the limit", () => {
    const text = `${"a".repeat(LIMIT - 2)}😀tail`;

    expect(excerptOf(text, LIMIT)).toBe(`${"a".repeat(LIMIT - 2)}😀`);
  });
});
