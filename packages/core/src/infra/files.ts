import { randomUUID } from "node:crypto";
import type { RmOptions } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";

export const TEMPORARY_SUFFIX = ".tmp";

export const removeQuietly = (
  path: string,
  options: RmOptions = {},
): Promise<void> =>
  rm(path, { force: true, ...options }).catch(() => undefined);

export const writeFileAtomically = async (
  path: string,
  data: string,
): Promise<void> => {
  const temporary = `${path}.${randomUUID()}${TEMPORARY_SUFFIX}`;
  try {
    await writeFile(temporary, data, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await removeQuietly(temporary);
    throw error;
  }
};
