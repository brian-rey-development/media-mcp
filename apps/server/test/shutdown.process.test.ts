import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  callToolFrame,
  framesOf,
  initializeFrames,
} from "./support/mcp-frames.js";
import { serverProcessEnv } from "./support/process-env.js";
import {
  isAlive,
  PROMPT_EXIT_MS,
  type RunningServer,
  SIGTERM_EXIT_CODE,
  startServer,
  waitForPid,
} from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const SLOW_VIDEO = "https://www.youtube.com/watch?v=vidAAAAAAAA";
const HOLD_MS = "60000";
const SECOND_SIGNAL_DELAY_MS = 200;

describe("shutting down during a slow download", () => {
  const temp = withTempDir("media-mcp-shutdown-");

  const startBusyServer = async (extraEnv: Record<string, string> = {}) => {
    const pidFile = join(temp.path, "yt-dlp.pid");
    const scratch = join(temp.path, "tmp");
    await mkdir(scratch);
    const server = startServer({
      ...serverProcessEnv(temp.path),
      FAKE_YTDLP_PID_FILE: pidFile,
      FAKE_YTDLP_HOLD_MS: HOLD_MS,
      TMPDIR: scratch,
      ...extraEnv,
    });
    const call = callToolFrame("get_transcripts", { urls: [SLOW_VIDEO] });
    server.child.stdin?.write(initializeFrames() + call);
    const pid = await waitForPid(pidFile);
    expect(await readdir(scratch)).not.toHaveLength(0);
    return { server, pid, scratch };
  };

  const stopAndTime = async (server: RunningServer, stop: () => void) => {
    const startedAt = Date.now();
    stop();
    const result = await server.exit;
    return { result, elapsedMs: Date.now() - startedAt };
  };

  it("kills yt-dlp and exits promptly when stdin closes", async () => {
    const { server, pid, scratch } = await startBusyServer();
    expect(isAlive(pid)).toBe(true);

    const { result, elapsedMs } = await stopAndTime(server, () =>
      server.child.stdin?.end(),
    );

    expect(result.code).toBe(0);
    expect(elapsedMs).toBeLessThan(PROMPT_EXIT_MS);
    expect(isAlive(pid)).toBe(false);
    expect(await readdir(scratch)).toEqual([]);
  });

  it("kills yt-dlp, removes its temp directory and exits 143 on SIGTERM", async () => {
    const { server, pid, scratch } = await startBusyServer();

    const { result, elapsedMs } = await stopAndTime(server, () =>
      server.child.kill("SIGTERM"),
    );

    expect(result.code).toBe(SIGTERM_EXIT_CODE);
    expect(elapsedMs).toBeLessThan(PROMPT_EXIT_MS);
    expect(isAlive(pid)).toBe(false);
    expect(await readdir(scratch)).toEqual([]);
    expect(result.stderr).toContain("shutting down, received SIGTERM");
  });

  it("still escalates to SIGKILL when a second signal arrives while yt-dlp ignores SIGTERM", async () => {
    const { server, pid } = await startBusyServer({
      FAKE_YTDLP_IGNORE_SIGTERM: "1",
    });

    const { result } = await stopAndTime(server, () => {
      server.child.kill("SIGTERM");
      setTimeout(() => server.child.kill("SIGTERM"), SECOND_SIGNAL_DELAY_MS);
    });

    expect(result.code).toBe(SIGTERM_EXIT_CODE);
    expect(isAlive(pid)).toBe(false);
  });

  it("keeps stdout limited to protocol frames while shutting down", async () => {
    const { server } = await startBusyServer();

    const { result } = await stopAndTime(server, () =>
      server.child.kill("SIGTERM"),
    );

    for (const frame of framesOf(result.stdout)) {
      expect(frame).toMatchObject({ jsonrpc: "2.0" });
    }
  });
});
