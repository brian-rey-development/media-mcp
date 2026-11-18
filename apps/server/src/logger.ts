import type { Writable } from "node:stream";

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

// A client that went away leaves stderr a dead pipe, and an unhandled stream
// error would then crash the shutdown that is trying to report it.
export const stderrWriter = (
  stream: Writable = process.stderr,
): ((line: string) => void) => {
  stream.on("error", () => undefined);
  return (line) => {
    stream.write(`${line}\n`);
  };
};

const neverThrowing =
  (write: (line: string) => void) =>
  (line: string): void => {
    try {
      write(line);
    } catch {
      return;
    }
  };

export const createLogger = (
  write: (line: string) => void = stderrWriter(),
): Logger => {
  const safeWrite = neverThrowing(write);
  return {
    info: (message) => safeWrite(`[info] ${message}`),
    error: (message) => safeWrite(`[error] ${message}`),
  };
};
