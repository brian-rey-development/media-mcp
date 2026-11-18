import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactedErrorMessage } from "../src/infra/errors.js";
import { redactPaths } from "../src/infra/redact.js";

describe("redactPaths", () => {
  it("replaces the home directory with a tilde", () => {
    expect(redactPaths(`cannot read ${join(homedir(), "notes.txt")}`)).toBe(
      `cannot read ${join("~", "notes.txt")}`,
    );
  });

  it("replaces the temp directory with a placeholder", () => {
    expect(redactPaths(`cannot write ${join(tmpdir(), "x")}`)).toBe(
      `cannot write ${join("<tmp>", "x")}`,
    );
  });

  it("leaves text without those paths alone", () => {
    expect(redactPaths("nothing to hide here")).toBe("nothing to hide here");
  });
});

describe("redactedErrorMessage", () => {
  it("redacts the message of an error", () => {
    const error = new Error(`EACCES: ${join(homedir(), "secret")}`);

    expect(redactedErrorMessage(error)).toBe(`EACCES: ${join("~", "secret")}`);
  });

  it("describes a value that is not an error", () => {
    expect(redactedErrorMessage("plain")).toBe("plain");
  });
});
