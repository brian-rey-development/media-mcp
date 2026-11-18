import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "../domain/result.js";
import { redactedErrorMessage } from "./errors.js";
import { removeQuietly } from "./files.js";

const createDirectory = async (prefix: string): Promise<Result<string>> => {
  try {
    return ok(await mkdtemp(join(tmpdir(), prefix)));
  } catch (error) {
    return err(
      "IO_FAILED",
      `Could not create a temporary directory (${redactedErrorMessage(error)})`,
    );
  }
};

export const withTempDirectory = async <T>(
  prefix: string,
  use: (directory: string) => Promise<Result<T>>,
): Promise<Result<T>> => {
  const created = await createDirectory(prefix);
  if (!created.ok) return created;
  try {
    return await use(created.value);
  } finally {
    await removeQuietly(created.value, { recursive: true });
  }
};
