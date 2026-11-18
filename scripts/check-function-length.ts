import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  exceedingLimit,
  MAX_FUNCTION_LINES,
  measureFunctions,
} from "./function-length.ts";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const WORKSPACE_ITEM = /^\s+-\s+["']?([^"'#\s]+)["']?/;
const WILDCARD = "*";
const SOURCE_DIR = "src";
const SCRIPTS_DIR = "scripts";
const SOURCE_FILE = /(?<!\.test|\.d)\.ts$/;
const FAILURE_EXIT_CODE = 1;

interface Scan {
  files: number;
  functions: number;
  offenders: string[];
}

const workspaceGlobs = (root: string): string[] => {
  const lines = readFileSync(join(root, WORKSPACE_FILE), "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "packages:");
  if (start === -1) throw new Error(`${WORKSPACE_FILE} has no packages list`);
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const glob = WORKSPACE_ITEM.exec(line)?.[1];
    if (glob === undefined) break;
    if (!glob.startsWith("!")) globs.push(glob);
  }
  return globs;
};

const subdirectories = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

const expandSegments = (base: string, segments: string[]): string[] => {
  const [head, ...rest] = segments;
  if (head === undefined) return [base];
  if (!existsSync(base)) return [];
  if (head.includes(WILDCARD) && head !== WILDCARD) {
    throw new Error(`unsupported workspace pattern segment "${head}"`);
  }
  const names = head === WILDCARD ? subdirectories(base) : [head];
  return names.flatMap((name) => expandSegments(join(base, name), rest));
};

const workspaceSourceDirs = (root: string): string[] =>
  workspaceGlobs(root)
    .flatMap((glob) => expandSegments(root, glob.split("/")))
    .map((workspace) => join(workspace, SOURCE_DIR));

const sourceDirs = (root: string): string[] =>
  [...workspaceSourceDirs(root), join(root, SCRIPTS_DIR)].filter(existsSync);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => SOURCE_FILE.test(name))
    .map((name) => join(dir, name));

const scanFile = (root: string, file: string): Scan => {
  const found = measureFunctions(file, readFileSync(file, "utf8"));
  const shown = file.slice(root.length + 1);
  const offenders = exceedingLimit(found).map(
    ({ name, line, length }) =>
      `${shown}:${line} ${name} is ${length} lines, the limit is ${MAX_FUNCTION_LINES}`,
  );
  return { files: 1, functions: found.length, offenders };
};

const scan = (root: string): Scan => {
  const files = sourceDirs(root).flatMap(sourceFiles);
  const totals: Scan = { files: 0, functions: 0, offenders: [] };
  for (const file of files) {
    const result = scanFile(root, file);
    totals.files += result.files;
    totals.functions += result.functions;
    totals.offenders.push(...result.offenders);
  }
  return totals;
};

const main = (root: string): number => {
  const { files, functions, offenders } = scan(root);
  if (offenders.length === 0) {
    console.log(
      `${functions} functions in ${files} files are within ${MAX_FUNCTION_LINES} lines`,
    );
    return 0;
  }
  console.error(offenders.join("\n"));
  return FAILURE_EXIT_CODE;
};

process.exitCode = main(process.argv[2] ?? process.cwd());
