import type { EventEmitter } from "node:events";
import { constants } from "node:os";
import { CLEAN_EXIT_CODE, FAILURE_EXIT_CODE } from "./exit-codes.js";
import type { Logger } from "./logger.js";
import type { Stop } from "./shutdown.js";

type WatchedProcess = EventEmitter & {
  stdin: EventEmitter;
  stdout: EventEmitter;
};

const BROKEN_PIPE = "EPIPE";
const SIGNAL_EXIT_BASE = 128;
// SIGHUP is what a closing terminal sends, and Node's default action for it would skip the graceful stop that kills the yt-dlp children.
const WATCHED_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

const exitCodeFor = (signal: NodeJS.Signals): number =>
  SIGNAL_EXIT_BASE + constants.signals[signal];

const describe = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const watchStdin = (proc: WatchedProcess, stop: Stop): void => {
  for (const event of ["end", "close"] as const) {
    proc.stdin.once(event, () => void stop("stdin closed", CLEAN_EXIT_CODE));
  }
};

// Never once(): with no listener left, a second signal would take Node's default action and end the process before the group SIGKILL of the yt-dlp children ran. The stop is idempotent, so repeats are absorbed.
const watchSignals = (proc: WatchedProcess, stop: Stop): void => {
  for (const signal of WATCHED_SIGNALS) {
    const code = exitCodeFor(signal);
    proc.on(signal, () => void stop(`received ${signal}`, code));
  }
};

const watchStdout = (proc: WatchedProcess, stop: Stop): void => {
  proc.stdout.on("error", (error: NodeJS.ErrnoException) => {
    const gone = error.code === BROKEN_PIPE;
    void stop("stdout closed", gone ? CLEAN_EXIT_CODE : FAILURE_EXIT_CODE);
  });
};

const watchFailures = (
  proc: WatchedProcess,
  stop: Stop,
  logger: Logger,
): void => {
  const reported = new Set<string>();
  for (const event of ["uncaughtException", "unhandledRejection"] as const) {
    proc.on(event, (error: unknown) => {
      if (!reported.has(event)) {
        reported.add(event);
        logger.error(`${event}, ${describe(error)}`);
      }
      void stop(event, FAILURE_EXIT_CODE);
    });
  }
};

export const watchProcess = (
  proc: WatchedProcess,
  stop: Stop,
  logger: Logger,
  { watchStdio = true }: { watchStdio?: boolean } = {},
): void => {
  if (watchStdio) {
    watchStdin(proc, stop);
    watchStdout(proc, stop);
  }
  watchSignals(proc, stop);
  watchFailures(proc, stop, logger);
};
