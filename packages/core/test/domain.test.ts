import { describe, expect, expectTypeOf, it } from "vitest";
import type { VerifiedDirectory } from "../src/domain/media.js";
import { cancelled, err } from "../src/domain/result.js";

describe("Result", () => {
  it("err omits the hint key when none is given", () => {
    expect(err("INVALID_URL", "m")).toStrictEqual({
      ok: false,
      error: { code: "INVALID_URL", message: "m" },
    });
  });

  it("cancelled is a CANCELLED error with the standard message", () => {
    expect(cancelled()).toStrictEqual({
      ok: false,
      error: { code: "CANCELLED", message: "The operation was cancelled" },
    });
  });
});

describe("VerifiedDirectory", () => {
  it("is not satisfied by a plain string, only verifyDirectory can mint it", () => {
    expectTypeOf<string>().not.toExtend<VerifiedDirectory>();
  });
});
