import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeYtDlpEnv } from "./support/fake-ytdlp-pipeline.js";
import { mcpHeaders, startRawRequest, TOKEN } from "./support/http-server.js";
import { callToolFrame } from "./support/mcp-frames.js";
import { FAKE_YTDLP_VERSION } from "./support/process-env.js";
import {
  freePort,
  isAlive,
  PROMPT_EXIT_MS,
  type RunningServer,
  runServer,
  SIGTERM_EXIT_CODE,
  startServer,
  waitFor,
  waitForPid,
} from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const SIGHUP_EXIT_CODE = 129;
const HOLD_MS = "60000";
const SLOW_VIDEO = "https://www.youtube.com/watch?v=vidAAAAAAAA";

describe("the built server in http mode", () => {
  const temp = withTempDir("media-mcp-http-process-");

  const httpEnv = async (extra: Record<string, string> = {}) => {
    const port = await freePort();
    const env = {
      ...fakeYtDlpEnv(temp.path, extra),
      MEDIA_MCP_TRANSPORT: "http",
      MEDIA_MCP_HTTP_TOKEN: TOKEN,
      MEDIA_MCP_HTTP_PORT: String(port),
    };
    return { env, port };
  };

  const waitUntilServing = (port: number) =>
    waitFor(async () =>
      fetch(`http://127.0.0.1:${port}/healthz`).then(
        (response) => (response.status === 200 ? true : undefined),
        () => undefined,
      ),
    );

  it("exits 1 with a clear message when the token is missing", async () => {
    const result = await runServer({ MEDIA_MCP_TRANSPORT: "http" }, "");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("MEDIA_MCP_HTTP_TOKEN");
  });

  it("exits 1 without echoing a token that is too short", async () => {
    const short = "short-secret";

    const result = await runServer(
      { MEDIA_MCP_TRANSPORT: "http", MEDIA_MCP_HTTP_TOKEN: short },
      "",
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MEDIA_MCP_HTTP_TOKEN");
    expect(result.stderr).toContain("openssl rand -hex 32");
    expect(result.stderr).not.toContain(short);
  });

  it("exits 1 for a transport name it does not know", async () => {
    const result = await runServer({ MEDIA_MCP_TRANSPORT: "sse" }, "");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MEDIA_MCP_TRANSPORT");
    expect(result.stderr).toContain("Set MEDIA_MCP_TRANSPORT to stdio or http");
  });

  it("exits 1 when the port is already taken", async () => {
    const first = await httpEnv();
    const holder = startServer(first.env);
    await waitUntilServing(first.port);

    const second = await runServer(first.env, "");
    holder.child.kill("SIGTERM");

    expect(second.code).toBe(1);
    expect(second.stderr).toContain("Could not listen");
    expect(second.stderr).not.toContain(TOKEN);
  });

  it("serves, ignores stdin closing, keeps stdout empty and stops on SIGTERM", async () => {
    const { env, port } = await httpEnv();
    const server = startServer(env);
    await waitUntilServing(port);

    server.child.stdin?.end();
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    server.child.kill("SIGTERM");
    const result = await server.exit;

    expect(health.status).toBe(200);
    expect(result.code).toBe(SIGTERM_EXIT_CODE);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `media-mcp ready on http://127.0.0.1:${port}/mcp (yt-dlp ${FAKE_YTDLP_VERSION})`,
    );
    expect(result.stderr).not.toContain(TOKEN);
  });

  it("warns that the token is the only protection when bound beyond loopback", async () => {
    const { env, port } = await httpEnv({ MEDIA_MCP_HTTP_HOST: "0.0.0.0" });
    const server = startServer(env);
    await waitUntilServing(port);

    server.child.kill("SIGTERM");
    const result = await server.exit;

    expect(result.stderr).toContain("only protection");
  });

  const startWithCallInFlight = async () => {
    const pidFile = join(temp.path, "yt-dlp.pid");
    const { env, port } = await httpEnv({
      FAKE_YTDLP_PID_FILE: pidFile,
      FAKE_YTDLP_HOLD_MS: HOLD_MS,
    });
    const server = startServer(env);
    await waitUntilServing(port);
    startRawRequest(
      port,
      {
        headers: mcpHeaders(),
        body: callToolFrame("get_transcripts", { urls: [SLOW_VIDEO] }),
      },
      () => undefined,
    );
    return { server, pid: await waitForPid(pidFile) };
  };

  const stopWith = async (server: RunningServer, signal: NodeJS.Signals) => {
    const startedAt = Date.now();
    server.child.kill(signal);
    const result = await server.exit;
    return { result, elapsedMs: Date.now() - startedAt };
  };

  it("kills a running yt-dlp and exits promptly on SIGTERM with a call in flight", async () => {
    const { server, pid } = await startWithCallInFlight();

    const { result, elapsedMs } = await stopWith(server, "SIGTERM");

    expect(result.code).toBe(SIGTERM_EXIT_CODE);
    expect(elapsedMs).toBeLessThan(PROMPT_EXIT_MS);
    expect(isAlive(pid)).toBe(false);
  });

  it("stops gracefully on SIGHUP, as when the terminal closes, and leaves no yt-dlp behind", async () => {
    const { server, pid } = await startWithCallInFlight();

    const { result, elapsedMs } = await stopWith(server, "SIGHUP");

    expect(result.code).toBe(SIGHUP_EXIT_CODE);
    expect(elapsedMs).toBeLessThan(PROMPT_EXIT_MS);
    expect(result.stderr).toContain("shutting down, received SIGHUP");
    expect(isAlive(pid)).toBe(false);
  });
});
