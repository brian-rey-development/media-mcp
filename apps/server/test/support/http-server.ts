import {
  type ClientRequest,
  type IncomingHttpHeaders,
  request,
} from "node:http";
import type { Services } from "@media-mcp/core";
import { createLifecycle } from "../../src/lifecycle.js";
import { createLogger } from "../../src/logger.js";
import { startHttpServer } from "../../src/transports/http.js";

export const TOKEN = "test-token-0123456789abcdef";
const LOOPBACK = "127.0.0.1";
const EPHEMERAL_PORT = 0;

export interface RunningHttpFixture {
  port: number;
  mcpUrl: URL;
  logs: string[];
}

export interface HttpFixtureOptions {
  host?: string;
  extraHosts?: string[];
  limits?: NonNullable<Parameters<typeof startHttpServer>[0]["limits"]>;
}

export const withHttpServer = async <T>(
  services: Services,
  run: (fixture: RunningHttpFixture) => Promise<T>,
  { host = LOOPBACK, extraHosts = [], limits }: HttpFixtureOptions = {},
): Promise<T> => {
  const logs: string[] = [];
  const running = await startHttpServer({
    settings: {
      token: TOKEN,
      host,
      port: EPHEMERAL_PORT,
      extraHosts,
    },
    services,
    lifecycle: createLifecycle(),
    logger: createLogger((line) => logs.push(line)),
    ...(limits !== undefined && { limits }),
  });
  try {
    const mcpUrl = new URL(`http://${LOOPBACK}:${running.port}/mcp`);
    return await run({ port: running.port, mcpUrl, logs });
  } finally {
    await running.close();
  }
};

export const mcpHeaders = (token: string | null = TOKEN) => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
});

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface RawRequest {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}

export const startRawRequest = (
  port: number,
  { method = "POST", path = "/mcp", headers = {}, body }: RawRequest,
  onResponse: (response: RawResponse) => void,
): ClientRequest => {
  const req = request(
    { host: LOOPBACK, port, method, path, headers },
    (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        onResponse({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    },
  );
  req.on("error", () => undefined);
  req.end(body);
  return req;
};

export const rawRequest = (
  port: number,
  options: RawRequest,
): Promise<RawResponse> =>
  new Promise((resolve) => {
    startRawRequest(port, options, resolve);
  });
