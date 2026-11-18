import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import type { MediaError } from "../src/domain/errors.js";
import { runProcess } from "../src/infra/process.js";
import {
  classifyFailure,
  isRateLimitFailure,
  summarizeDiagnostic,
} from "../src/providers/ytdlp/failures.js";
import {
  BOT_CHECK_HINT,
  DISK_SPACE_HINT,
  FFMPEG_INSTALL_HINT,
  NODE_RUNTIME_HINT,
  RETRY_HINT,
  THROTTLED_HINT,
  UPGRADE_HINT,
  VIDEO_UNAVAILABLE_HINT,
} from "../src/providers/ytdlp/hints.js";
import { unwrapError } from "./support/unwrap.js";

const failed = (message: string): MediaError => ({
  code: "PROCESS_FAILED",
  message,
});

// Verbatim from yt-dlp 2026.10.26 extractor/youtube/_video.py, where both come through raise_no_formats(expected=True).
const SESSION_RATE_LIMITED =
  "[youtube] eRsGyueVLvQ: This content isn't available, try again later. The current session has been rate-limited by YouTube for up to an hour. It is recommended to use `-t sleep` to add a delay between video requests to avoid exceeding the rate limit. For more information, refer to  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#this-content-isnt-available-try-again-later";
const CAPTCHA_WALL =
  "[youtube] eRsGyueVLvQ: Video unavailable. YouTube is requiring a captcha challenge before playback";

describe("classifyFailure", () => {
  it.each([
    [
      "[youtube] jNQXAC9IWRw: This video is unavailable",
      "VIDEO_UNAVAILABLE",
      VIDEO_UNAVAILABLE_HINT,
    ],
    [
      "[youtube] abc: Private video. Sign in if you've been granted access",
      "VIDEO_UNAVAILABLE",
      VIDEO_UNAVAILABLE_HINT,
    ],
    [
      "[youtube] abc: Sign in to confirm your age",
      "VIDEO_UNAVAILABLE",
      VIDEO_UNAVAILABLE_HINT,
    ],
    [
      "unable to download video data: HTTP Error 429: Too Many Requests",
      "RATE_LIMITED",
      THROTTLED_HINT,
    ],
    [
      "[youtube] abc: Sign in to confirm you're not a bot",
      "RATE_LIMITED",
      BOT_CHECK_HINT,
    ],
    [SESSION_RATE_LIMITED, "RATE_LIMITED", THROTTLED_HINT],
    [CAPTCHA_WALL, "RATE_LIMITED", THROTTLED_HINT],
    [
      "[youtube] abc: Unable to extract initial data; please report this issue",
      "TOOL_OUTDATED",
      UPGRADE_HINT,
    ],
    [
      "[youtube] abc: n challenge solving failed. Ensure you have a supported JavaScript runtime",
      "TOOL_OUTDATED",
      NODE_RUNTIME_HINT,
    ],
    [
      "[youtube] abc: Requested format is not available",
      "TOOL_OUTDATED",
      NODE_RUNTIME_HINT,
    ],
    [
      "Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location",
      "TOOL_MISSING",
      FFMPEG_INSTALL_HINT,
    ],
    [
      "unable to write data: No space left on device",
      "IO_FAILED",
      DISK_SPACE_HINT,
    ],
  ])("maps %j to %s with its own hint", (message, code, hint) => {
    expect(classifyFailure(failed(message))).toEqual({ code, message, hint });
  });

  it("does not read a throttle into a title that echoes a path in the error", () => {
    const message =
      "unable to open for writing: [Errno 13] Permission denied: 'Bypass_captcha_rate-limited [abc] 720p.mp4'";

    expect(classifyFailure(failed(message)).code).toBe("PROCESS_FAILED");
  });

  it("keeps an unrecognised failure as PROCESS_FAILED with a retry hint", () => {
    expect(classifyFailure(failed("something else entirely"))).toEqual({
      code: "PROCESS_FAILED",
      message: "something else entirely",
      hint: RETRY_HINT,
    });
  });

  it.each(["TOOL_MISSING", "TIMEOUT", "CANCELLED"] as const)(
    "never reclassifies %s even when the text looks like a video failure",
    (code) => {
      const error: MediaError = { code, message: "This video is unavailable" };

      expect(classifyFailure(error)).toEqual(error);
    },
  );
});

describe("isRateLimitFailure", () => {
  it.each([
    "HTTP Error 429: Too Many Requests",
    "Sign in to confirm you're not a bot",
    SESSION_RATE_LIMITED,
    CAPTCHA_WALL,
  ])("recognises the raw failure %j", (message) => {
    expect(isRateLimitFailure(failed(message))).toBe(true);
  });

  it("does not flag other failures", () => {
    expect(isRateLimitFailure(failed("This video is unavailable"))).toBe(false);
    expect(isRateLimitFailure(failed("something odd happened"))).toBe(false);
  });
});

describe("classification of a real failed process", () => {
  const script =
    "console.error('ERROR: [youtube] x: HTTP Error 429'); process.exit(1)";

  it("ignores the command line, so an argument reading Private video cannot misclassify", async () => {
    const result = await runProcess("node", ["-e", script, "Private video"], {
      timeoutMs: 10_000,
    });

    const error = unwrapError(result);
    expect(error.message).not.toMatch(/Private video/);
    expect(classifyFailure(error).code).toBe("RATE_LIMITED");
  });
});

describe("summarizeDiagnostic", () => {
  const SUMMARY = "The caption file was not written";

  it("appends the last error or warning line about the track without its prefix", () => {
    const stderr = [
      "WARNING: Unable to download video subtitles for 'fr': first",
      "[download] noise",
      "ERROR: Unable to download video subtitles for 'fr': second",
      "WARNING: Unable to download video subtitles for 'de': HTTP Error 429",
      "trailing",
    ].join("\n");

    expect(summarizeDiagnostic(SUMMARY, stderr, "fr")).toBe(
      `${SUMMARY} (Unable to download video subtitles for 'fr': second)`,
    );
  });

  it("returns the summary alone when no diagnostic names the track", () => {
    const stderr =
      "[download] 100%\nWARNING: Unable to download video subtitles for 'fr-orig': x";

    expect(summarizeDiagnostic(SUMMARY, stderr, "fr")).toBe(SUMMARY);
  });

  it("redacts the home directory and caps the length", () => {
    const stderr = `WARNING: 'en' ${homedir()}/secret ${"y".repeat(1_000)}`;

    const summary = summarizeDiagnostic(SUMMARY, stderr, "en");

    expect(summary).toHaveLength(500);
    expect(summary).toContain("~/secret");
    expect(summary).not.toContain(homedir());
  });
});
