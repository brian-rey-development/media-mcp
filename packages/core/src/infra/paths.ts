import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { VerifiedDirectory } from "../domain/media.js";
import { err, ok, type Result } from "../domain/result.js";
import { isNotFound, redactedErrorMessage } from "./errors.js";
import { redactPaths } from "./redact.js";

const isSymlink = (path: string): Promise<boolean> =>
  lstat(path).then(
    (stats) => stats.isSymbolicLink(),
    () => false,
  );

const isInside = (root: string, candidate: string): boolean => {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(prefix);
};

const resolveRealPath = async (path: string): Promise<string | undefined> => {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isNotFound(error) || (await isSymlink(path))) return undefined;
    const parent = await resolveRealPath(dirname(path));
    return parent && join(parent, basename(path));
  }
};

const unresolvableError = (label: string, root: string): Result<never> =>
  err(
    "OUTPUT_PATH_ESCAPE",
    redactPaths(`Output path "${label}" could not be resolved safely`),
    redactPaths(`Use an existing directory or a new one inside ${root}`),
  );

const outsideRootError = (label: string, root: string): Result<never> =>
  err(
    "OUTPUT_PATH_ESCAPE",
    redactPaths(`Output path "${label}" resolves outside the output root`),
    redactPaths(`Use a path inside ${root}`),
  );

const createDirectory = async (path: string): Promise<Result<void>> => {
  try {
    await mkdir(path, { recursive: true });
    return ok(undefined);
  } catch (error) {
    return err(
      "IO_FAILED",
      `Could not create the output directory "${redactPaths(path)}": ${redactedErrorMessage(error)}`,
      "Choose a path that is a writable directory",
    );
  }
};

export const resolveWithinRoot = async (
  root: string,
  requested: string | undefined,
): Promise<Result<string>> => {
  const label = requested ?? root;
  const [realRoot, realTarget] = await Promise.all([
    resolveRealPath(resolve(root)),
    resolveRealPath(resolve(root, requested ?? ".")),
  ]);
  if (!realRoot || !realTarget) return unresolvableError(label, root);
  if (!isInside(realRoot, realTarget)) return outsideRootError(label, root);
  return ok(realTarget);
};

const verifyDirectory = async (
  root: string,
  requested: string | undefined,
): Promise<Result<VerifiedDirectory>> => {
  const planned = await resolveWithinRoot(root, requested);
  if (!planned.ok) return planned;
  const created = await createDirectory(planned.value);
  if (!created.ok) return created;
  const confirmed = await resolveWithinRoot(root, requested);
  if (!confirmed.ok) return confirmed;
  // Only this function mints the brand.
  return ok(confirmed.value as VerifiedDirectory);
};

export const createDirectoryVerifier = (
  root: string,
  requested?: string,
): (() => Promise<Result<VerifiedDirectory>>) => {
  let pending: Promise<Result<VerifiedDirectory>> | undefined;
  return () => {
    pending ??= verifyDirectory(root, requested);
    return pending;
  };
};

const unreadableError = (error: unknown): Result<never> =>
  err(
    "IO_FAILED",
    `The file could not be read (${redactedErrorMessage(error)})`,
  );

export const locateWithinRoot = async (
  root: VerifiedDirectory,
  path: string,
): Promise<Result<string | undefined>> => {
  try {
    const [realRoot, realPath] = await Promise.all([
      realpath(root),
      realpath(resolve(root, path)),
    ]);
    return isInside(realRoot, realPath)
      ? ok(realPath)
      : outsideRootError(path, root);
  } catch (error) {
    return isNotFound(error) ? ok(undefined) : unreadableError(error);
  }
};
