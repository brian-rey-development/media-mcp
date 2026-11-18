import { redactPaths } from "./redact.js";

const MAX_MESSAGE_CHARS = 500;
const TAIL_LINES = 5;
const ERROR_PREFIX = /^ERROR:\s*/;
const ELLIPSIS = "...";

export const boundedMessage = (text: string): string => {
  const redacted = redactPaths(text);
  return redacted.length <= MAX_MESSAGE_CHARS
    ? redacted
    : redacted.slice(0, MAX_MESSAGE_CHARS - ELLIPSIS.length) + ELLIPSIS;
};

export const linesOf = (stderr: string): string[] =>
  stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const lastPrefixedLine = (stderr: string, prefix: RegExp): string | undefined =>
  linesOf(stderr)
    .findLast((line) => prefix.test(line))
    ?.replace(prefix, "");

export const summarizeFailure = (
  exitCode: number | undefined,
  stderr: string,
): string =>
  boundedMessage(
    lastPrefixedLine(stderr, ERROR_PREFIX) ??
      [
        `exit code ${exitCode ?? "unknown"}`,
        ...linesOf(stderr).slice(-TAIL_LINES),
      ].join("\n"),
  );
