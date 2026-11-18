import { err, ok, type Result } from "../../domain/result.js";
import type { Config } from "../../infra/config.js";
import type { ProcessRunner } from "../../infra/process.js";
import { baseArgs } from "./args.js";
import { execYtDlp } from "./exec.js";
import { FFMPEG_INSTALL_HINT, UPGRADE_HINT } from "./hints.js";

const MIN_YT_DLP_VERSION = "2026.10.26";
const VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;
const FFMPEG_COMMAND = "ffmpeg";
const VERSION_ARGS = baseArgs(["--version"]);

const versionParts = (version: string): number[] =>
  version.split(".").map(Number);

const isOlderThanMinimum = (version: string): boolean => {
  const actual = versionParts(version);
  const firstDifference = versionParts(MIN_YT_DLP_VERSION)
    .map((part, index) => (actual[index] ?? 0) - part)
    .find((difference) => difference !== 0);
  return firstDifference !== undefined && firstDifference < 0;
};

const unrecognised = (version: string): Result<never> =>
  err("PROCESS_FAILED", `Unrecognised yt-dlp version output "${version}"`);

const outdated = (version: string): Result<never> =>
  err(
    "TOOL_OUTDATED",
    `yt-dlp ${version} is older than the required ${MIN_YT_DLP_VERSION}`,
    UPGRADE_HINT,
  );

export const checkYtDlp = async (
  run: ProcessRunner,
  config: Config,
): Promise<Result<{ version: string }>> => {
  const result = await execYtDlp({ run, config }, VERSION_ARGS);
  if (!result.ok) return result;
  const version = result.value.stdout.trim();
  if (!VERSION_PATTERN.test(version)) return unrecognised(version);
  return isOlderThanMinimum(version) ? outdated(version) : ok({ version });
};

export const checkFfmpeg = async (
  run: ProcessRunner,
  config: Config,
): Promise<Result<{ version: string }>> => {
  const result = await run(FFMPEG_COMMAND, ["-version"], {
    timeoutMs: config.processTimeoutMs,
    missingToolHint: FFMPEG_INSTALL_HINT,
  });
  if (!result.ok) return result;
  const [firstLine = ""] = result.value.stdout.split("\n");
  return ok({ version: firstLine.trim() });
};
