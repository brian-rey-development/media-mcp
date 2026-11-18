import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { watchProcess } from "../src/process-events.js";

const watched = (options?: { watchStdio?: boolean }) => {
  const proc = Object.assign(new EventEmitter(), {
    stdin: new EventEmitter(),
    stdout: new EventEmitter(),
  });
  const stop = vi.fn(async () => undefined);
  const lines: string[] = [];
  watchProcess(
    proc,
    stop,
    createLogger((line) => lines.push(line)),
    options,
  );
  return { proc, stop, lines };
};

describe("watching the process", () => {
  it.each(["end", "close"])("stops cleanly when stdin emits %s", (event) => {
    const { proc, stop } = watched();

    proc.stdin.emit(event);

    expect(stop).toHaveBeenCalledWith("stdin closed", 0);
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ])("stops with exit code %s on %s", (signal, code) => {
    const { proc, stop } = watched();

    proc.emit(signal);

    expect(stop).toHaveBeenCalledWith(`received ${signal}`, code);
  });

  it("keeps absorbing signals after the first one, so the default action never ends the process mid shutdown", () => {
    const { proc, stop } = watched();

    proc.emit("SIGINT");
    proc.emit("SIGINT");
    proc.emit("SIGTERM");
    proc.emit("SIGHUP");

    expect(stop).toHaveBeenCalledTimes(4);
    expect(proc.listenerCount("SIGINT")).toBe(1);
  });

  it("ignores stdin and stdout when told not to watch them, and still stops on SIGHUP", () => {
    const { proc, stop } = watched({ watchStdio: false });

    expect(proc.stdin.listenerCount("end")).toBe(0);
    expect(proc.stdout.listenerCount("error")).toBe(0);
    proc.stdin.emit("end");
    expect(stop).not.toHaveBeenCalled();
    proc.emit("SIGHUP");

    expect(stop).toHaveBeenCalledWith("received SIGHUP", 129);
  });

  it("treats a broken stdout pipe as the client leaving", () => {
    const { proc, stop } = watched();

    proc.stdout.emit(
      "error",
      Object.assign(new Error("gone"), { code: "EPIPE" }),
    );

    expect(stop).toHaveBeenCalledWith("stdout closed", 0);
  });

  it("treats any other stdout error as a failure", () => {
    const { proc, stop } = watched();

    proc.stdout.emit(
      "error",
      Object.assign(new Error("disk"), { code: "EIO" }),
    );

    expect(stop).toHaveBeenCalledWith("stdout closed", 1);
  });

  it.each(["uncaughtException", "unhandledRejection"])(
    "logs %s to stderr and stops with a failure code",
    (event) => {
      const { proc, stop, lines } = watched();

      proc.emit(event, new Error("kaboom"));

      expect(lines).toEqual([
        expect.stringContaining(`[error] ${event}, Error: kaboom`),
      ]);
      expect(stop).toHaveBeenCalledWith(event, 1);
    },
  );

  it("logs each failure kind at most once however often it repeats", () => {
    const { proc, stop, lines } = watched();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      proc.emit("uncaughtException", new Error("again"));
    }
    proc.emit("unhandledRejection", new Error("other kind"));

    expect(lines).toHaveLength(2);
    expect(stop).toHaveBeenCalledTimes(6);
  });

  it("describes a non-error rejection reason", () => {
    const { proc, lines } = watched();

    proc.emit("unhandledRejection", "plain reason");

    expect(lines).toEqual(["[error] unhandledRejection, plain reason"]);
  });
});
