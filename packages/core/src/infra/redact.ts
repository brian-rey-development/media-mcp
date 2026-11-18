import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const TEMP_PLACEHOLDER = "<tmp>";
const HOME_PLACEHOLDER = "~";

const realTmpdir = (): string => {
  try {
    return realpathSync(tmpdir());
  } catch {
    return tmpdir();
  }
};

export const redactPaths = (text: string): string => {
  const placeholders: [string, string][] = [
    [realTmpdir(), TEMP_PLACEHOLDER],
    [tmpdir(), TEMP_PLACEHOLDER],
    [homedir(), HOME_PLACEHOLDER],
  ];
  return placeholders.reduce(
    (redacted, [path, label]) =>
      path.length > 1 ? redacted.split(path).join(label) : redacted,
    text,
  );
};
