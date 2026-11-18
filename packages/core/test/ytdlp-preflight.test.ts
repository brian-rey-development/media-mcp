import { describe, expect, it } from "vitest";
import { err } from "../src/domain/result.js";
import { checkFfmpeg, checkYtDlp } from "../src/providers/ytdlp/preflight.js";
import { testConfig } from "./support/config.js";
import {
  createFakeRunner,
  firstCall,
  stdoutOf,
} from "./support/fake-runner.js";

const versionRunner = (stdout: string) =>
  createFakeRunner(() => stdoutOf(`${stdout}\n`));

describe("checkYtDlp", () => {
  it.each(["2026.10.26", "2026.10.26.232815", "2026.11.01", "2027.01.01"])(
    "accepts version %s",
    async (version) => {
      const { run } = versionRunner(version);

      expect(await checkYtDlp(run, testConfig)).toEqual({
        ok: true,
        value: { version },
      });
    },
  );

  it.each(["2026.10.25", "2025.12.31", "2026.09.30.999"])(
    "reports %s as TOOL_OUTDATED with an upgrade hint",
    async (version) => {
      const { run } = versionRunner(version);

      expect(await checkYtDlp(run, testConfig)).toMatchObject({
        ok: false,
        error: {
          code: "TOOL_OUTDATED",
          message: expect.stringContaining(version),
          hint: expect.stringContaining("brew upgrade yt-dlp"),
        },
      });
    },
  );

  it("reports a missing binary with a platform neutral install hint", async () => {
    const { run } = createFakeRunner(({ options }) =>
      err("TOOL_MISSING", "yt-dlp was not found", options.missingToolHint),
    );

    const result = await checkYtDlp(run, testConfig);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_MISSING",
        hint: expect.stringMatching(/brew install yt-dlp.*github\.com\/yt-dlp/),
      },
    });
    expect(JSON.stringify(result)).toContain("MEDIA_MCP_YTDLP_PATH");
  });

  it("reports unrecognisable version output as PROCESS_FAILED", async () => {
    const { run } = versionRunner("nightly-build");

    expect(await checkYtDlp(run, testConfig)).toMatchObject({
      ok: false,
      error: {
        code: "PROCESS_FAILED",
        message: expect.stringContaining("nightly-build"),
      },
    });
  });

  it("asks the configured binary for its version", async () => {
    const { run, calls } = versionRunner("2026.10.26");

    await checkYtDlp(run, { ...testConfig, ytDlpPath: "/opt/yt-dlp" });

    expect(firstCall(calls).command).toBe("/opt/yt-dlp");
    expect(firstCall(calls).args).toContain("--version");
  });
});

describe("checkFfmpeg", () => {
  it("returns the first line of the version banner", async () => {
    const { run, calls } = createFakeRunner(() =>
      stdoutOf(
        "ffmpeg version 7.1.1 Copyright (c) 2000-2025\nbuilt with clang\n",
      ),
    );

    const result = await checkFfmpeg(run, testConfig);

    expect(result).toEqual({
      ok: true,
      value: { version: "ffmpeg version 7.1.1 Copyright (c) 2000-2025" },
    });
    expect(firstCall(calls)).toMatchObject({
      command: "ffmpeg",
      args: ["-version"],
    });
  });

  it("reports a missing ffmpeg as TOOL_MISSING with the install hint", async () => {
    const { run } = createFakeRunner(({ options }) =>
      err("TOOL_MISSING", "ffmpeg was not found", options.missingToolHint),
    );

    expect(await checkFfmpeg(run, testConfig)).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_MISSING",
        hint: expect.stringMatching(/brew install ffmpeg/),
      },
    });
  });
});
