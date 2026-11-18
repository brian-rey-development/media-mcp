import { type ChildProcess, execFile, spawn } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SERVER_ENTRY = fileURLToPath(
  new URL("../../dist/index.js", import.meta.url),
);
const WAIT_TIMEOUT_MS = 4_000;
const POLL_INTERVAL_MS = 25;
export const SIGTERM_EXIT_CODE = 143;
export const PROMPT_EXIT_MS = 3_000;

export interface ServerRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunningServer {
  child: ChildProcess;
  exit: Promise<ServerRun>;
  stdout(): string;
}

const running = new Set<RunningServer>();
const execFileAsync = promisify(execFile);

const SECONDS_PER_TIME_FIELD = [1, 60, 3_600, 86_400];

const parseCpuTime = (text: string): number =>
  text
    .trim()
    .split(/[-:]/)
    .reverse()
    .reduce(
      (total, field, index) =>
        total + Number(field) * (SECONDS_PER_TIME_FIELD[index] ?? 0),
      0,
    );

const collect = (stream: Readable): (() => string) => {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString("utf8");
};

export const startServer = (env: Record<string, string>): RunningServer => {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  const exit = new Promise<ServerRun>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: stdout(), stderr: stderr() }),
    );
  });
  const server = { child, exit, stdout };
  running.add(server);
  void exit.finally(() => running.delete(server)).catch(() => undefined);
  return server;
};

export const reapServers = async (): Promise<void> => {
  const leftovers = [...running];
  for (const { child } of leftovers) child.kill("SIGKILL");
  await Promise.allSettled(leftovers.map((server) => server.exit));
};

export const cpuSeconds = async (pid: number): Promise<number> => {
  const { stdout } = await execFileAsync(
    "ps",
    ["-o", "time=", "-p", String(pid)],
    { env: { ...process.env, LC_ALL: "C" } },
  );
  return parseCpuTime(stdout);
};

export const runServer = (
  env: Record<string, string>,
  stdin: string,
): Promise<ServerRun> => {
  const server = startServer(env);
  server.child.stdin?.end(stdin);
  return server.exit;
};

const writeExecutable = async (path: string, script: string) => {
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
};

export const writeFakeFfmpeg = (directory: string) =>
  writeExecutable(
    join(directory, "ffmpeg"),
    "#!/bin/sh\necho ffmpeg version 7.0\n",
  );

export const nodeOnlyPath = async (directory: string): Promise<string> => {
  const bin = join(directory, "bin");
  await mkdir(bin, { recursive: true });
  await symlink(process.execPath, join(bin, "node"));
  return bin;
};

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const waitFor = async <T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await probe();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("timed out waiting for the condition");
};

export const waitForPid = (pidFile: string): Promise<number> =>
  waitFor(async () => {
    const pid = await readFile(pidFile, "utf8").then(
      (text) => Number(text.trim()),
      () => 0,
    );
    return pid > 0 ? pid : undefined;
  });
