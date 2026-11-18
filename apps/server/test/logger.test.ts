import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, stderrWriter } from "../src/logger.js";

describe("the logger", () => {
  it("prefixes each level", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.info("up");
    logger.error("down");

    expect(lines).toEqual(["[info] up", "[error] down"]);
  });

  it("never throws when the destination fails", () => {
    const logger = createLogger(() => {
      throw new Error("EPIPE");
    });

    expect(() => logger.info("up")).not.toThrow();
    expect(() => logger.error("down")).not.toThrow();
  });
});

describe("the stderr writer", () => {
  it("writes each line followed by a newline", () => {
    const stream = new PassThrough();

    createLogger(stderrWriter(stream)).info("up");

    expect(stream.read().toString()).toBe("[info] up\n");
  });

  it("survives its stream failing", () => {
    const stream = new PassThrough();
    createLogger(stderrWriter(stream));

    expect(() =>
      stream.emit("error", Object.assign(new Error("gone"), { code: "EPIPE" })),
    ).not.toThrow();
  });
});
