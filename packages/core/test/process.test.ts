import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "../src/infra/process.js";
import { BYTES_PER_MEGABYTE } from "../src/infra/units.js";
import { withTempDir } from "./support/temp-dir.js";

const TIMEOUT_MS = 10_000;
const SLEEP_SCRIPT = "setTimeout(() => {}, 30000)";
const OVERSIZED_OUTPUT_BYTES = 33 * BYTES_PER_MEGABYTE;
const READY_THEN_SLEEP_SCRIPT = `console.log("ready"); ${SLEEP_SCRIPT}`;
const GRANDCHILD_SCRIPT = `
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", ${JSON.stringify(SLEEP_SCRIPT)}], { stdio: "ignore" });
console.log(child.pid);
setTimeout(() => {}, 30000);
`;

const node = (script: string) => ["-e", script] as const;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("runProcess", () => {
  const temp = withTempDir();

  it("captures stdout and stderr", async () => {
    const result = await runProcess(
      "node",
      node("console.log('hello'); console.error('warn')"),
      { timeoutMs: TIMEOUT_MS },
    );

    expect(result).toEqual({
      ok: true,
      value: { stdout: "hello", stderr: "warn" },
    });
  });

  it("runs in the requested working directory", async () => {
    const result = await runProcess(
      "node",
      node("console.log(process.cwd())"),
      {
        timeoutMs: TIMEOUT_MS,
        cwd: temp.path,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: { stdout: temp.path, stderr: "" },
    });
  });

  it("gives the child a closed stdin so a reader does not hang until the timeout", async () => {
    const started = performance.now();

    const result = await runProcess("cat", [], { timeoutMs: TIMEOUT_MS });

    expect(result).toEqual({ ok: true, value: { stdout: "", stderr: "" } });
    expect(performance.now() - started).toBeLessThan(TIMEOUT_MS / 2);
  });

  it("fails with a clear message when the output exceeds the buffer limit", async () => {
    const result = await runProcess(
      "node",
      node(`process.stdout.write("x".repeat(${OVERSIZED_OUTPUT_BYTES}))`),
      { timeoutMs: TIMEOUT_MS },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PROCESS_FAILED",
        message: expect.stringMatching(/32 MB/),
      },
    });
  });

  it("does not buffer stdout that is streamed to a line callback", async () => {
    const size = OVERSIZED_OUTPUT_BYTES;
    const lines: string[] = [];

    const result = await runProcess(
      "node",
      node(
        `for (let i = 0; i < ${size / 1024}; i++) console.log("x".repeat(1023))`,
      ),
      { timeoutMs: TIMEOUT_MS * 3, onStdoutLine: (line) => lines.push(line) },
    );

    expect(result).toEqual({ ok: true, value: { stdout: "", stderr: "" } });
    expect(lines).toHaveLength(size / 1024);
  });

  describe("failures", () => {
    it("reports a non-zero exit as PROCESS_FAILED with the last ERROR line", async () => {
      const result = await runProcess(
        "node",
        node(
          "console.error('noise'); console.error('ERROR: first'); console.error('ERROR: boom'); console.error('tail'); process.exit(3)",
        ),
        { timeoutMs: TIMEOUT_MS },
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "PROCESS_FAILED", message: "boom" },
      });
    });

    it("falls back to the exit code and the last five stderr lines", async () => {
      const result = await runProcess(
        "node",
        node(
          "for (let i = 1; i <= 8; i++) console.error('line ' + i); process.exit(4)",
        ),
        { timeoutMs: TIMEOUT_MS },
      );

      expect(result).toEqual({
        ok: false,
        error: {
          code: "PROCESS_FAILED",
          message: "exit code 4\nline 4\nline 5\nline 6\nline 7\nline 8",
        },
      });
    });

    it("never repeats the command line in the message", async () => {
      const result = await runProcess(
        "node",
        [
          ...node("process.exit(2)"),
          "--",
          "--secret-argument",
          "Private video",
        ],
        { timeoutMs: TIMEOUT_MS },
      );

      expect(JSON.stringify(result)).not.toMatch(
        /secret-argument|Private video|process\.exit/,
      );
    });

    it("caps the message at 500 characters", async () => {
      const result = await runProcess(
        "node",
        node("console.error('ERROR: ' + 'y'.repeat(2000)); process.exit(1)"),
        { timeoutMs: TIMEOUT_MS },
      );

      expect(result.ok ? "" : result.error.message).toHaveLength(500);
    });

    it("replaces the home and temp directories", async () => {
      const result = await runProcess(
        "node",
        node(
          `console.error("ERROR: cannot write " + ${JSON.stringify(homedir())} + "/secret and " + require("node:os").tmpdir() + "/x"); process.exit(1)`,
        ),
        { timeoutMs: TIMEOUT_MS },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { message: "cannot write ~/secret and <tmp>/x" },
      });
    });
  });

  it("reports a child that outlives the timeout as TIMEOUT in seconds with the hint", async () => {
    const result = await runProcess("node", node(SLEEP_SCRIPT), {
      timeoutMs: 1_000,
      timeoutHint: "raise the limit",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "TIMEOUT",
        message: "The operation timed out after 1 seconds",
        hint: "raise the limit",
      },
    });
  });

  it("kills the child and reports CANCELLED when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = runProcess("node", node(READY_THEN_SLEEP_SCRIPT), {
      timeoutMs: TIMEOUT_MS,
      signal: controller.signal,
      onStdoutLine: () => controller.abort(),
    });

    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
  });

  describe("after the process has finished", () => {
    afterEach(() => vi.restoreAllMocks());

    it("never signals a process group, even if the caller aborts later", async () => {
      const kill = vi.spyOn(process, "kill");
      const controller = new AbortController();

      const result = await runProcess("node", node("process.exit(0)"), {
        timeoutMs: TIMEOUT_MS,
        signal: controller.signal,
      });
      controller.abort();

      expect(result.ok).toBe(true);
      expect(kill).not.toHaveBeenCalled();
    });
  });

  it("reports an already-aborted signal as CANCELLED", async () => {
    const result = await runProcess("node", node(SLEEP_SCRIPT), {
      timeoutMs: TIMEOUT_MS,
      signal: AbortSignal.abort(),
    });

    expect(result).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("kills a grandchild of the process when the signal aborts", async () => {
    const controller = new AbortController();
    const grandchild = Promise.withResolvers<number>();
    const pending = runProcess("node", node(GRANDCHILD_SCRIPT), {
      timeoutMs: TIMEOUT_MS,
      signal: controller.signal,
      onStdoutLine: (line) => grandchild.resolve(Number(line)),
    });
    const pid = await grandchild.promise;
    expect(isAlive(pid)).toBe(true);

    controller.abort();
    await pending;

    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: 5_000,
    });
  });

  it("kills a grandchild of the process when the timeout fires", async () => {
    const grandchild = Promise.withResolvers<number>();
    const pending = runProcess("node", node(GRANDCHILD_SCRIPT), {
      timeoutMs: 1_000,
      onStdoutLine: (line) => grandchild.resolve(Number(line)),
    });
    const pid = await grandchild.promise;

    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "TIMEOUT" },
    });
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: 5_000,
    });
  });

  it("reports a missing binary as TOOL_MISSING with the hint it was given", async () => {
    const result = await runProcess("definitely-not-installed-tool", [], {
      timeoutMs: TIMEOUT_MS,
      missingToolHint: "install it somehow",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TOOL_MISSING", hint: "install it somehow" },
    });
  });

  it("reports a missing tool as TOOL_MISSING even when it was given an existing folder", async () => {
    const result = await runProcess("definitely-not-installed-tool", [], {
      timeoutMs: TIMEOUT_MS,
      cwd: temp.path,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TOOL_MISSING" },
    });
  });

  it("reports a working folder removed before the start as IO_FAILED with a retry hint", async () => {
    const result = await runProcess("node", node("process.exit(0)"), {
      timeoutMs: TIMEOUT_MS,
      cwd: join(temp.path, "removed"),
      missingToolHint: "install it somehow",
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IO_FAILED",
        hint: expect.stringMatching(/^The folder was removed/),
      },
    });
  });

  it("names only the binary, not its directory, in the missing tool message", async () => {
    const result = await runProcess("/nowhere/at/all/hidden-tool", [], {
      timeoutMs: TIMEOUT_MS,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { message: "hidden-tool was not found on this machine" },
    });
  });

  it("gives a neutral hint naming the command when no hint is given", async () => {
    const result = await runProcess("definitely-not-installed-tool", [], {
      timeoutMs: TIMEOUT_MS,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_MISSING",
        hint: expect.stringContaining("definitely-not-installed-tool"),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/brew/i);
  });

  describe("the environment of the child", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("lacks every MEDIA_MCP_ variable and keeps the rest", async () => {
      vi.stubEnv("MEDIA_MCP_HTTP_TOKEN", "secret-token");
      vi.stubEnv("MEDIA_MCP_YTDLP_PATH", "/opt/yt-dlp");

      const result = await runProcess(
        "node",
        node("console.log(JSON.stringify(Object.keys(process.env)))"),
        { timeoutMs: TIMEOUT_MS },
      );

      const names: string[] = JSON.parse(
        result.ok ? result.value.stdout : "[]",
      );
      expect(names.filter((name) => name.startsWith("MEDIA_MCP_"))).toEqual([]);
      expect(names).toEqual(expect.arrayContaining(["PATH", "HOME"]));
    });
  });

  it("delivers each stdout line while the process is still running", async () => {
    const lines: string[] = [];
    const firstLine = Promise.withResolvers<void>();
    let settled = false;
    const script =
      "console.log('one'); setTimeout(() => console.log('two'), 300)";

    const pending = runProcess("node", node(script), {
      timeoutMs: TIMEOUT_MS,
      onStdoutLine: (line) => {
        lines.push(line);
        firstLine.resolve();
      },
    }).finally(() => {
      settled = true;
    });
    await firstLine.promise;

    expect(settled).toBe(false);
    expect(lines).toEqual(["one"]);
    expect((await pending).ok).toBe(true);
    expect(lines).toEqual(["one", "two"]);
  });
});
