import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { execa } from "execa";
import { cancelled, err, ok, type Result } from "../domain/result.js";
import { ENV_PREFIX } from "./config.js";
import { NOT_FOUND_CODE } from "./errors.js";
import {
  FORCE_KILL_DELAY_MS,
  spawnsInOwnGroup,
  superviseGroup,
} from "./process-group.js";
import { redactPaths } from "./redact.js";
import { summarizeFailure } from "./stderr.js";
import { BYTES_PER_MEGABYTE, MS_PER_SECOND } from "./units.js";

const MAX_BUFFER_BYTES = 32 * BYTES_PER_MEGABYTE;
const MISSING_DIRECTORY_HINT =
  "The folder was removed while the call ran. Retry the call, which creates it again";

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  onStdoutLine?: (line: string) => void;
  missingToolHint?: string;
  timeoutHint?: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<Result<{ stdout: string; stderr: string }>>;

const lineTap = (onLine: (line: string) => void) =>
  function* tap(line: string) {
    onLine(line);
    yield line;
  };

// The server keeps its own secrets in MEDIA_MCP_* variables (the HTTP token among them), and yt-dlp, its JavaScript runtime and ffmpeg need none of them.
const childEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith(ENV_PREFIX),
    ),
  );

const FIXED_OPTIONS = {
  shell: false,
  reject: false,
  extendEnv: false,
  stdin: "ignore",
  maxBuffer: MAX_BUFFER_BYTES,
  detached: spawnsInOwnGroup,
  forceKillAfterDelay: FORCE_KILL_DELAY_MS,
} as const;

const spawn = (
  command: string,
  args: readonly string[],
  options: RunOptions,
  stop: AbortSignal,
) =>
  execa(command, [...args], {
    ...FIXED_OPTIONS,
    env: childEnv(),
    cancelSignal: stop,
    ...(options.cwd && { cwd: options.cwd }),
    ...(options.onStdoutLine && {
      stdout: [lineTap(options.onStdoutLine)],
      buffer: { stdout: false, stderr: true },
    }),
  });

type Outcome = Awaited<ReturnType<typeof spawn>>;

const missingToolError = (command: string, hint: string | undefined) => {
  const name = basename(command);
  return err(
    "TOOL_MISSING",
    `${name} was not found on this machine`,
    hint ?? `Install ${name} and make sure it is on your PATH`,
  );
};

const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

// Node reports a missing working directory exactly like a missing executable (ENOENT on spawn), so the directory is checked.
const notFoundError = async (
  command: string,
  options: RunOptions,
): Promise<Result<never>> =>
  options.cwd !== undefined && !(await isDirectory(options.cwd))
    ? err(
        "IO_FAILED",
        `The working folder "${redactPaths(options.cwd)}" no longer exists`,
        MISSING_DIRECTORY_HINT,
      )
    : missingToolError(command, options.missingToolHint);

const stoppedError = (timedOut: boolean, options: RunOptions): Result<never> =>
  timedOut
    ? err(
        "TIMEOUT",
        `The operation timed out after ${options.timeoutMs / MS_PER_SECOND} seconds`,
        options.timeoutHint,
      )
    : cancelled();

const bufferExceeded = (): Result<never> =>
  err(
    "PROCESS_FAILED",
    `The tool produced more than ${MAX_BUFFER_BYTES / BYTES_PER_MEGABYTE} MB of output`,
  );

const failureOf = (
  outcome: Outcome,
  options: RunOptions,
  timedOut: boolean,
): Result<never> | undefined => {
  if (outcome.isCanceled) return stoppedError(timedOut, options);
  if (outcome.isMaxBuffer) return bufferExceeded();
  if (!outcome.failed) return undefined;
  return err(
    "PROCESS_FAILED",
    summarizeFailure(outcome.exitCode, outcome.stderr),
  );
};

export const runProcess: ProcessRunner = async (command, args, options) => {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const stop = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const subprocess = spawn(command, args, options, stop);
  const release = superviseGroup(subprocess.pid, stop);
  try {
    const outcome = await subprocess;
    if (outcome.code === NOT_FOUND_CODE) return notFoundError(command, options);
    return (
      failureOf(outcome, options, timeout.aborted) ??
      ok({ stdout: outcome.stdout ?? "", stderr: outcome.stderr })
    );
  } finally {
    release();
  }
};
