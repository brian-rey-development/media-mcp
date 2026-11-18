import { homedir } from "node:os";
import type { BatchOutcome, VideoRef } from "@media-mcp/core";
import { describe, expect, it } from "vitest";
import { toBatchOutput } from "../src/tools/batch-output.js";
import { failedWith, outcomeOf } from "./support/fake-services.js";
import { URL_A } from "./support/fixtures.js";

const keepNothing = () => ({});

const failed = (error: Parameters<typeof failedWith>[1]) => {
  const outcome: BatchOutcome<{ ref: VideoRef }> = outcomeOf([
    failedWith(URL_A, error),
  ]);
  return toBatchOutput(outcome, keepNothing).entries;
};

describe("toBatchOutput", () => {
  it("copies only code, message and hint from a core failure", () => {
    const error = {
      code: "VIDEO_UNAVAILABLE",
      message: "Gone",
      hint: "Try later",
      secret: "must not leave the server",
    } as const;

    expect(failed(error)).toEqual([
      {
        url: URL_A,
        inputUrl: URL_A,
        ok: false,
        error: {
          code: "VIDEO_UNAVAILABLE",
          message: "Gone",
          hint: "Try later",
        },
      },
    ]);
  });

  it("leaves the hint key out when the core failure has none", () => {
    const [entry] = failed({ code: "TIMEOUT", message: "Slow" });

    expect(entry).toHaveProperty("error", { code: "TIMEOUT", message: "Slow" });
    expect(entry).not.toHaveProperty("error.hint");
  });

  it("redacts the home folder from a message and a hint even when core did not", () => {
    const home = homedir();

    const [entry] = failed({
      code: "IO_FAILED",
      message: `Cannot write ${home}/out/a.txt`,
      hint: `Free space under ${home}/out`,
    });

    expect(entry).toMatchObject({
      error: {
        message: "Cannot write ~/out/a.txt",
        hint: "Free space under ~/out",
      },
    });
  });
});
