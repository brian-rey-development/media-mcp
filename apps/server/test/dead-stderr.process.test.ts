import { describe, expect, it } from "vitest";
import { SETTLE_TIMEOUT_MS } from "../src/shutdown.js";
import {
  framesOf,
  initializeFrames,
  listToolsFrame,
} from "./support/mcp-frames.js";
import { serverProcessEnv } from "./support/process-env.js";
import {
  cpuSeconds,
  type RunningServer,
  SIGTERM_EXIT_CODE,
  startServer,
  waitFor,
} from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const EXPECTED_FRAMES = 2;
const CPU_WINDOW_MS = 1_000;
const MAX_IDLE_CPU_SECONDS = 0.4;

describe("a server whose stderr is a dead pipe", () => {
  const temp = withTempDir("media-mcp-stderr-");

  const startWithDeadStderr = async (): Promise<RunningServer> => {
    const server = startServer(serverProcessEnv(temp.path));
    server.child.stderr?.destroy();
    server.child.stdin?.write(initializeFrames() + listToolsFrame());
    await waitFor(async () =>
      framesSeen(server) >= EXPECTED_FRAMES ? true : undefined,
    );
    return server;
  };

  const framesSeen = (server: RunningServer) =>
    framesOf(server.stdout()).length;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("keeps serving without spinning when it cannot log", async () => {
    const server = await startWithDeadStderr();
    const pid = server.child.pid ?? 0;

    const before = await cpuSeconds(pid);
    await sleep(CPU_WINDOW_MS);
    const after = await cpuSeconds(pid);

    expect(after - before).toBeLessThan(MAX_IDLE_CPU_SECONDS);
  });

  it("exits within the settle timeout when stdin closes", async () => {
    const server = await startWithDeadStderr();
    const closedAt = Date.now();

    server.child.stdin?.end();
    const result = await server.exit;

    expect(result.code).toBe(0);
    expect(Date.now() - closedAt).toBeLessThan(SETTLE_TIMEOUT_MS);
  });

  it("still stops on SIGTERM", async () => {
    const server = await startWithDeadStderr();

    server.child.kill("SIGTERM");
    const result = await server.exit;

    expect(result.code).toBe(SIGTERM_EXIT_CODE);
  });
});
