import { readFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../src/transports/http.js";
import { entriesOf, textOf } from "./support/client.js";
import { pipelineServices } from "./support/fake-ytdlp-pipeline.js";
import {
  mcpHeaders,
  type RawResponse,
  rawRequest,
  startRawRequest,
  TOKEN,
  withHttpServer,
} from "./support/http-server.js";
import { callToolFrame, initializeFrame } from "./support/mcp-frames.js";
import { isAlive, waitFor, waitForPid } from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const SINTEL = "https://www.youtube.com/watch?v=eRsGyueVLvQ";
const SLOW_VIDEO = "https://www.youtube.com/watch?v=vidAAAAAAAA";
const WRONG_TOKEN = "wrong-token-9999999999";
const INITIALIZE = initializeFrame();
const TUNNEL_HOST = "media.example.com";
const LONG_REQUEST_TIMEOUT_MS = 60_000;
const SLOW_CALL_MS = 1_200;

const clientFor = (mcpUrl: URL) =>
  new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });

afterEach(() => vi.unstubAllEnvs());

describe("the HTTP transport", () => {
  const temp = withTempDir("media-mcp-http-");
  const withServer = <T>(
    run: Parameters<typeof withHttpServer<T>>[1],
    options?: Parameters<typeof withHttpServer<T>>[2],
  ) => withHttpServer(pipelineServices(temp.path), run, options);

  it("serves initialize, tools/list and get_transcripts to the SDK client with the token", async () => {
    await withServer(async ({ mcpUrl }) => {
      const client = new Client({ name: "http-test", version: "0.0.0" });
      await client.connect(clientFor(mcpUrl));

      const { tools } = await client.listTools();
      const result = await client.callTool({
        name: "get_transcripts",
        arguments: { urls: [SINTEL] },
      });
      await client.close();

      expect(tools.map((tool) => tool.name)).toContain("get_transcripts");
      expect(entriesOf(result)).toMatchObject([
        { ok: true, videoId: "eRsGyueVLvQ", mode: "inline" },
      ]);
      expect(textOf(result.content)).toContain("Sintel");
    });
  });

  it("lets a remote client read a long transcript back page by page with the token", async () => {
    const budget = { MEDIA_MCP_CHAR_BUDGET: "100" };
    await withHttpServer(
      pipelineServices(temp.path, budget),
      async ({ mcpUrl }) => {
        const client = new Client({ name: "http-test", version: "0.0.0" });
        await client.connect(clientFor(mcpUrl));
        const saved = await client.callTool({
          name: "get_transcripts",
          arguments: { urls: [SINTEL] },
        });
        const [entry] = entriesOf(saved);
        const path = typeof entry?.filePath === "string" ? entry.filePath : "";

        const page = await client.callTool({
          name: "read_transcript_file",
          arguments: { path, maxLines: 2 },
        });
        const outside = await client.callTool({
          name: "read_transcript_file",
          arguments: { path: "/etc/passwd" },
        });
        await client.close();

        expect(entry).toMatchObject({ mode: "file" });
        expect(page.structuredContent).toMatchObject({
          startLine: 1,
          nextStartLine: 3,
        });
        expect(textOf(page.content)).toContain("<untrusted_content");
        expect(outside.isError).toBe(true);
        expect(textOf(outside.content)).toContain("OUTPUT_PATH_ESCAPE");
      },
    );
  });

  it("answers 401 with the same response for a missing and a wrong token", async () => {
    await withServer(async ({ port }) => {
      const missing = await rawRequest(port, {
        headers: mcpHeaders(null),
        body: INITIALIZE,
      });
      const wrong = await rawRequest(port, {
        headers: mcpHeaders(WRONG_TOKEN),
        body: INITIALIZE,
      });

      expect(missing.status).toBe(401);
      expect(missing.headers["www-authenticate"]).toBe("Bearer");
      expect(JSON.parse(missing.body)).toMatchObject({
        jsonrpc: "2.0",
        error: { message: "Unauthorized" },
      });
      expect(wrong.status).toBe(missing.status);
      expect(wrong.body).toBe(missing.body);
      expect(wrong.headers["www-authenticate"]).toBe("Bearer");
    });
  });

  it("rejects a Host header outside the allowed set with 403 even with a valid token", async () => {
    await withServer(async ({ port }) => {
      const response = await rawRequest(port, {
        headers: { ...mcpHeaders(), Host: "evil.example.com" },
        body: INITIALIZE,
      });

      expect(response.status).toBe(403);
    });
  });

  it("accepts a Host header listed in the extra allowed hosts", async () => {
    await withServer(
      async ({ port }) => {
        const response = await rawRequest(port, {
          method: "GET",
          path: "/healthz",
          headers: { Host: TUNNEL_HOST },
        });

        expect(response.status).toBe(200);
      },
      { extraHosts: [TUNNEL_HOST] },
    );
  });

  it("accepts an extra allowed host that carries the server port", async () => {
    await withServer(
      async ({ port }) => {
        const response = await rawRequest(port, {
          method: "GET",
          path: "/healthz",
          headers: { Host: `${TUNNEL_HOST}:${port}` },
        });

        expect(response.status).toBe(200);
      },
      { extraHosts: [TUNNEL_HOST] },
    );
  });

  it.each(["GET", "DELETE"])(
    "answers 405 with Allow POST for %s /mcp",
    async (method) => {
      await withServer(async ({ port }) => {
        const response = await rawRequest(port, {
          method,
          headers: mcpHeaders(),
        });

        expect(response.status).toBe(405);
        expect(response.headers.allow).toBe("POST");
      });
    },
  );

  it("asks for the token before it reveals which methods /mcp accepts", async () => {
    await withServer(async ({ port }) => {
      const response = await rawRequest(port, { method: "GET" });

      expect(response.status).toBe(401);
    });
  });

  it("answers 404 for unknown paths and for a POST to /healthz", async () => {
    await withServer(async ({ port }) => {
      const unknown = await rawRequest(port, {
        path: "/other",
        headers: mcpHeaders(),
        body: INITIALIZE,
      });
      const health = await rawRequest(port, {
        path: "/healthz",
        headers: mcpHeaders(),
        body: INITIALIZE,
      });

      expect([unknown.status, health.status]).toEqual([404, 404]);
    });
  });

  it("answers /healthz with 200 ok and no token", async () => {
    await withServer(async ({ port }) => {
      const response = await rawRequest(port, {
        method: "GET",
        path: "/healthz",
      });

      expect(response.status).toBe(200);
      expect(response.body).toBe("ok");
    });
  });

  it("answers 413 for a body over the size cap", async () => {
    await withServer(async ({ port }) => {
      const response = await rawRequest(port, {
        headers: mcpHeaders(),
        body: "x".repeat(MAX_BODY_BYTES + 1),
      });

      expect(response.status).toBe(413);
    });
  });

  it("answers 415 when the body is not declared as JSON", async () => {
    await withServer(async ({ port }) => {
      const response = await rawRequest(port, {
        headers: { ...mcpHeaders(), "Content-Type": "text/plain" },
        body: INITIALIZE,
      });

      expect(response.status).toBe(415);
    });
  });

  it("never writes the token to the logs or to any response, and counts failures", async () => {
    await withServer(async ({ port, logs }) => {
      const responses: RawResponse[] = [
        await rawRequest(port, { headers: mcpHeaders(null), body: INITIALIZE }),
        await rawRequest(port, {
          headers: mcpHeaders(WRONG_TOKEN),
          body: INITIALIZE,
        }),
        await rawRequest(port, { headers: mcpHeaders(), body: INITIALIZE }),
        await rawRequest(port, { method: "GET", path: "/nope" }),
      ];

      const everything = JSON.stringify([logs, responses]);
      expect(everything).not.toContain(TOKEN);
      expect(everything).not.toContain(WRONG_TOKEN);
      expect(logs).toEqual([
        "[error] rejected request 1 without a valid token from 127.0.0.1",
        "[error] rejected request 2 without a valid token from 127.0.0.1",
      ]);
    });
  });

  it("kills the yt-dlp process when the HTTP client goes away", async () => {
    const pidFile = join(temp.path, "yt-dlp.pid");
    vi.stubEnv("FAKE_YTDLP_PID_FILE", pidFile);
    vi.stubEnv("FAKE_YTDLP_HOLD_MS", "60000");
    await withServer(async ({ port }) => {
      const call = startRawRequest(
        port,
        {
          headers: mcpHeaders(),
          body: callToolFrame("get_transcripts", { urls: [SLOW_VIDEO] }),
        },
        () => undefined,
      );
      const pid = await waitForPid(pidFile);
      expect(isAlive(pid)).toBe(true);

      call.destroy();

      await waitFor(async () => (isAlive(pid) ? undefined : true));
    });
  });

  it("keeps the HTTP token out of the environment of yt-dlp", async () => {
    const envFile = join(temp.path, "yt-dlp-env.json");
    vi.stubEnv("MEDIA_MCP_HTTP_TOKEN", TOKEN);
    vi.stubEnv("FAKE_YTDLP_ENV_FILE", envFile);
    await withServer(async ({ mcpUrl }) => {
      const client = new Client({ name: "http-test", version: "0.0.0" });
      await client.connect(clientFor(mcpUrl));
      await client.callTool({
        name: "get_transcripts",
        arguments: { urls: [SINTEL] },
      });
      await client.close();
    });

    const seen = JSON.parse(await readFile(envFile, "utf8"));
    expect(seen).toHaveProperty("FAKE_YTDLP_ENV_FILE", envFile);
    expect(seen).toHaveProperty("PATH");
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
    expect(
      Object.keys(seen).filter((name) => name.startsWith("MEDIA_MCP_")),
    ).toEqual([]);
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const openSocket = (port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => resolve(socket));
    socket.once("error", reject);
  });

const closedWithin = (socket: Socket, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.on("error", () => undefined);
    socket.resume();
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

const reachable = (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${port}/healthz`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(1_000),
  }).then(
    (response) => response.status === 200,
    () => false,
  );

interface Exchange {
  text: string;
  closed: boolean;
}

const exchange = (
  socket: Socket,
  request: string,
  timeoutMs: number,
): Promise<Exchange> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const finish = (closed: boolean) => {
      clearTimeout(timer);
      resolve({ text: Buffer.concat(chunks).toString("utf8"), closed });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("close", () => finish(true));
    socket.write(request);
  });

const UNFINISHED_BODY_BYTES = 1_000_000;
const withUnfinishedBody = (
  requestLine: string,
  host: string,
  headers: readonly string[],
): string =>
  [
    requestLine,
    `Host: ${host}`,
    `Content-Length: ${UNFINISHED_BODY_BYTES}`,
    ...headers,
    "",
    "{",
  ].join("\r\n");

describe("the HTTP connection limits", () => {
  const temp = withTempDir("media-mcp-http-limits-");
  const withServer = <T>(
    run: Parameters<typeof withHttpServer<T>>[1],
    options: Parameters<typeof withHttpServer<T>>[2],
  ) => withHttpServer(pipelineServices(temp.path), run, options);

  it("drops a connection that never finishes its request headers", async () => {
    const limits = {
      headersTimeoutMs: 200,
      requestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
      checkIntervalMs: 50,
    };
    await withServer(
      async ({ port }) => {
        const socket = await openSocket(port);
        socket.write("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n");

        expect(await closedWithin(socket, 3_000)).toBe(true);
      },
      { limits },
    );
  });

  it("refuses connections beyond the cap and serves again once idle ones are dropped", async () => {
    const cap = 3;
    const limits = {
      maxConnections: cap,
      headersTimeoutMs: 300,
      requestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
      checkIntervalMs: 50,
    };
    await withServer(
      async ({ port }) => {
        const idle = await Promise.all(
          Array.from({ length: cap }, () => openSocket(port)),
        );
        await sleep(50);

        expect(await reachable(port)).toBe(false);

        await waitFor(async () => ((await reachable(port)) ? true : undefined));
        for (const socket of idle) socket.destroy();
      },
      { limits },
    );
  });

  it("does not cut a tool call that outlasts the request timeout", async () => {
    vi.stubEnv("FAKE_YTDLP_HOLD_MS", String(SLOW_CALL_MS));
    const limits = {
      headersTimeoutMs: 200,
      requestTimeoutMs: 300,
      checkIntervalMs: 50,
    };
    await withServer(
      async ({ mcpUrl }) => {
        const client = new Client({ name: "http-test", version: "0.0.0" });
        await client.connect(clientFor(mcpUrl));

        const startedAt = Date.now();
        const result = await client.callTool({
          name: "get_transcripts",
          arguments: { urls: [SINTEL] },
        });
        await client.close();

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SLOW_CALL_MS);
        expect(entriesOf(result)).toMatchObject([{ ok: true, mode: "inline" }]);
      },
      { limits },
    );
  });

  describe("rejected requests", () => {
    const BEARER = `Authorization: Bearer ${TOKEN}`;
    const CLOSE_PATIENCE_MS = 2_000;
    const limits = {
      requestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
      checkIntervalMs: 50,
    };

    const LOCAL = (port: number) => `127.0.0.1:${port}`;
    it.each([
      ["401", "POST /mcp HTTP/1.1", LOCAL, []],
      ["403", "POST /mcp HTTP/1.1", () => "evil.example.com", [BEARER]],
      ["404", "POST /other HTTP/1.1", LOCAL, [BEARER]],
      ["405", "GET /mcp HTTP/1.1", LOCAL, [BEARER]],
    ])(
      "answers %s with Connection: close and drops the socket without waiting for the body",
      async (status, requestLine, hostOf, headers) => {
        await withServer(
          async ({ port }) => {
            const socket = await openSocket(port);

            const { text, closed } = await exchange(
              socket,
              withUnfinishedBody(requestLine, hostOf(port), headers),
              CLOSE_PATIENCE_MS,
            );

            socket.destroy();
            expect(text).toContain(`HTTP/1.1 ${status}`);
            expect(text.toLowerCase()).toContain("connection: close");
            expect(closed).toBe(true);
          },
          { limits },
        );
      },
    );

    it("keeps the connection of a healthy request alive", async () => {
      await withServer(
        async ({ port }) => {
          const socket = await openSocket(port);

          const { text, closed } = await exchange(
            socket,
            `GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
            300,
          );

          expect(text).toContain("HTTP/1.1 200");
          expect(text.toLowerCase()).toContain("connection: keep-alive");
          expect(closed).toBe(false);
          socket.destroy();
        },
        { limits },
      );
    });
  });

  describe("connections per remote address", () => {
    const PER_ADDRESS = 2;
    const limits = {
      maxConnectionsPerAddress: PER_ADDRESS,
      requestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
    };
    const dropped = async (socket: Socket) => {
      socket.on("error", () => undefined);
      return await closedWithin(socket, 500);
    };

    it("drops a connection beyond the cap from one address when the server is not on loopback, and takes new ones once one is gone", async () => {
      await withServer(
        async ({ port }) => {
          const held = await Promise.all(
            Array.from({ length: PER_ADDRESS }, () => openSocket(port)),
          );

          expect(await dropped(await openSocket(port))).toBe(true);
          held[0]?.destroy();
          await sleep(100);

          const again = await openSocket(port);
          expect(await dropped(again)).toBe(false);
          for (const socket of [...held, again]) socket.destroy();
        },
        { limits, host: "0.0.0.0" },
      );
    });

    it("does not apply on loopback, where a tunnel makes every client look like one address", async () => {
      await withServer(
        async ({ port }) => {
          const sockets = await Promise.all(
            Array.from({ length: PER_ADDRESS }, () => openSocket(port)),
          );
          const beyondCap = await openSocket(port);

          expect(await dropped(beyondCap)).toBe(false);
          for (const socket of [...sockets, beyondCap]) socket.destroy();
        },
        { limits },
      );
    });
  });
});
